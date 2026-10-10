import * as net from "net";
import * as crypto from "crypto";
import * as fs from "fs";
import { EventEmitter } from "events";
import * as adb from "./adb";
import { ControlChannel, EngineOptions } from "./control";
import { APP_NAME, ENGINE_TAG, SOCKET_TAG, SERVER_VERSION, PROTOCOL_VERSION, HELLO_MAGIC } from "./product";

export class VideoPacket {
  constructor(
    public data: Buffer,
    public pts: number,
    public isConfig: boolean,
    public isKeyFrame: boolean
  ) {}
}

const CHAN_SESSION = 0;
const CHAN_VIDEO = 1;
const CHAN_AUDIO = 2;
const CHAN_DEVICE = 4;

const KIND_CODEC = 0;
const KIND_PACKET = 1;
const KIND_SESSION = 2;
const KIND_END = 3;

export interface SessionHello {
  deviceName: string;
  caps: number;
}

export class MirrorSession extends EventEmitter {
  private serverProcess: adb.ServerProcess | null = null;
  private server: net.Server | null = null;
  private socket: net.Socket | null = null;
  private control: ControlChannel | null = null;
  private socketName = "";
  private remoteJarPath = "";
  private ended = false;
  private rxHead = Buffer.alloc(0);

  deviceName = "";
  caps = 0;
  videoCodecId = "";
  audioCodecId = "";
  videoWidth = 0;
  videoHeight = 0;

  constructor(
    private serial: string,
    private options: EngineOptions,
    private engineJarPath: string
  ) {
    super();
  }

  get controlChannel(): ControlChannel {
    if (!this.control) throw new Error("session not started");
    return this.control;
  }

  async start(): Promise<SessionHello> {
    const scidHex = (crypto.randomBytes(4).readUInt32BE(0) & 0x7fffffff).toString(16).padStart(8, "0");
    this.remoteJarPath = `/data/local/tmp/${ENGINE_TAG}-${scidHex}.jar`;
    await this.prepareServer(scidHex);
    this.socketName = `${SOCKET_TAG}_${scidHex}`;

    const port = await new Promise<number>((resolve, reject) => {
      const server = net.createServer((socket) => {
        if (this.socket) {
          socket.destroy();
          return;
        }
        this.server = null;
        this.onAccepted(socket);
      });
      server.on("error", reject);
      server.listen({ host: "127.0.0.1", port: 0 }, () => {
        const addr = server.address() as net.AddressInfo;
        resolve(addr.port);
      });
      this.server = server;
    });

    await adb.reverse(this.serial, this.socketName, port);

    const args = `${SERVER_VERSION} ${scidHex}`;
    this.serverProcess = adb.startServerProcess(this.serial, this.remoteJarPath, args, (line) =>
      this.emit("log", `server: ${line}`)
    );

    const socket = await this.waitForConnection(15000);
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.socket = socket;
    this.control = new ControlChannel(
      (text) => this.emit("clipboard", text),
      () => this.breakConnection()
    );

    const hello = await this.readHello(socket);
    this.control.attach(socket);
    this.control.sendConfig(this.options);
    if (this.options.autoLaunchPackage && this.options.newDisplay) {
      try {
        this.control.startApp(this.options.autoLaunchPackage);
      } catch {}
    }
    this.pumpDemux(socket);
    return hello;
  }

  private async prepareServer(scidHex: string): Promise<void> {
    const localJar = this.engineJarPath;
    const hash = crypto.createHash("sha256").update(await fs.promises.readFile(localJar)).digest("hex");
    const cachePath = `/data/local/tmp/${ENGINE_TAG}-cache-${hash}.jar`;
    const sessionPath = `/data/local/tmp/${ENGINE_TAG}-${scidHex}.jar`;
    const remoteHash = await adb.sha256sumRemote(this.serial, cachePath);
    if (remoteHash && remoteHash.toLowerCase() === hash) {
      await adb.runShell(this.serial, `cp ${cachePath} ${sessionPath}`);
      return;
    }
    await adb.pushFile(this.serial, localJar, sessionPath);
    try {
      await adb.runShell(this.serial, `cp ${sessionPath} ${cachePath}`);
    } catch {}
  }

  private waitForConnection(timeoutMs: number): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("device did not connect within timeout"));
      }, timeoutMs);
      const check = setInterval(() => {
        if (this.socket) {
          cleanup();
          resolve(this.socket);
        }
      }, 25);
      const cleanup = () => {
        clearTimeout(timer);
        clearInterval(check);
      };
      if (this.socket) {
        cleanup();
        resolve(this.socket);
      }
    });
  }

  private onAccepted(socket: net.Socket) {
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 5000);
    this.socket = socket;
    socket.on("error", (err) => {
      this.emit("log", `socket error: ${err.message}`);
      this.handleDisconnect();
    });
    socket.on("close", () => this.handleDisconnect());
  }

  private async readHello(socket: net.Socket): Promise<SessionHello> {
    const head = await this.readExact(socket, 5);
    if (head[0] !== CHAN_SESSION) throw new Error("engine incompatible: hello expected on session channel");
    const len = head.readUInt32BE(1);
    if (len < 11 || len > 1024) throw new Error(`invalid hello size (${len} bytes)`);
    const hello = await this.readExact(socket, len);
    if (hello.readUInt32BE(0) !== HELLO_MAGIC) throw new Error("engine incompatible: TMIR magic missing");
    const proto = hello.readUInt16BE(4);
    if (proto !== PROTOCOL_VERSION) throw new Error(`engine protocol v${proto} not supported (expected v${PROTOCOL_VERSION})`);
    this.caps = hello.readUInt32BE(6);
    const nameLen = hello[10];
    if (nameLen > len - 11) throw new Error("invalid server name length");
    this.deviceName = hello.slice(11, 11 + nameLen).toString("utf8");
    return { deviceName: this.deviceName, caps: this.caps };
  }

  private readExact(socket: net.Socket, n: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      if (this.rxHead.length >= n) {
        const out = this.rxHead.slice(0, n);
        this.rxHead = this.rxHead.slice(n);
        resolve(out);
        return;
      }
      const chunks: Buffer[] = [];
      let have = this.rxHead.length;
      if (have > 0) {
        chunks.push(this.rxHead);
        this.rxHead = Buffer.alloc(0);
      }
      const onData = (d: Buffer) => {
        chunks.push(d);
        have += d.length;
        if (have >= n) {
          socket.pause();
          socket.removeListener("data", onData);
          socket.removeListener("end", onEnd);
          socket.removeListener("error", onErr);
          const all = Buffer.concat(chunks);
          const out = all.slice(0, n);
          const rest = all.slice(n);
          this.rxHead = Buffer.alloc(0);
          resolve(out);
          if (rest.length > 0) {
            this.rxHead = rest;
            socket.resume();
          } else {
            socket.resume();
          }
        }
      };
      const onEnd = () => {
        socket.removeListener("data", onData);
        socket.removeListener("error", onErr);
        reject(Object.assign(new Error("connection closed mid-frame"), { code: "ECONN_CLOSED" }));
      };
      const onErr = (e: Error) => {
        socket.removeListener("data", onData);
        socket.removeListener("end", onEnd);
        reject(e);
      };
      socket.on("data", onData);
      socket.on("end", onEnd);
      socket.on("error", onErr);
      socket.resume();
    });
  }

  private async pumpDemux(socket: net.Socket) {
    try {
      for (;;) {
        const head = await this.readExact(socket, 5);
        const channel = head[0];
        const size = head.readUInt32BE(1);
        if (size === 0 || size > 64 * 1024 * 1024) throw new Error(`invalid stream frame size: ${size}`);
        const payload = await this.readExact(socket, size);
        this.dispatch(channel, payload);
        if (this.ended) return;
      }
    } catch (err: unknown) {
      if (!this.ended && err instanceof Error && !String((err as { code?: string }).code).includes("CANCEL")) {
        this.emit("log", `mux loop ended: ${err instanceof Error ? err.message : err}`);
      }
      if (!this.ended) this.handleDisconnect();
    }
  }

  private dispatch(channel: number, payload: Buffer) {
    switch (channel) {
      case CHAN_VIDEO:
        this.readStreamPacket(payload, true);
        break;
      case CHAN_AUDIO:
        this.readStreamPacket(payload, false);
        break;
      case CHAN_DEVICE:
        this.control?.feedDeviceMessage(payload);
        break;
    }
  }

  private readStreamPacket(payload: Buffer, video: boolean) {
    if (payload.length < 1) return;
    switch (payload[0]) {
      case KIND_CODEC:
        if (payload.length >= 5) {
          const id = payload.slice(1, 5).toString("ascii").replace(/\0/g, "");
          if (video) {
            this.videoCodecId = id;
            this.emit("videoMeta", { codec: id });
          } else {
            this.audioCodecId = id;
            this.emit("audioMeta", { codec: id });
          }
        }
        break;
      case KIND_SESSION:
        if (video && payload.length >= 9) {
          this.videoWidth = payload.readUInt32BE(1);
          this.videoHeight = payload.readUInt32BE(5);
          this.emit("videoSize", this.videoWidth, this.videoHeight);
        }
        break;
      case KIND_END:
        if (payload.length >= 2) {
          const isError = payload[1] !== 0;
          if (video) this.emit("log", `video stream ended${isError ? " with error" : ""}`);
          else this.emit("audioEnded", isError);
        }
        break;
      case KIND_PACKET:
        if (payload.length < 10) return;
        const flags = payload[9];
        const data = payload.slice(10);
        const pts = payload.readBigInt64BE(1);
        const packet = new VideoPacket(data, Number(pts), (flags & 0x01) !== 0, (flags & 0x02) !== 0);
        if (video) this.emit("videoPacket", packet);
        else this.emit("audioPacket", packet);
        break;
    }
  }

  private handleDisconnect() {
    if (this.ended) return;
    this.ended = true;
    this.emit("disconnected");
  }

  breakConnection() {
    try {
      this.socket?.destroy();
    } catch {}
  }

  async disconnect() {
    if (this.ended) return;
    this.ended = true;
    this.control?.dispose();
    try {
      this.socket?.destroy();
    } catch {}
    try {
      this.serverProcess?.proc.kill();
    } catch {}
    if (this.socketName) await adb.reverseRemove(this.serial, this.socketName);
    this.emit("disconnected");
  }
}
