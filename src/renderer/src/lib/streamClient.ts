import { Mirror } from "./mirror";
import { bridge } from "./bridge";

export interface StreamMeta {
  serial: string;
  codec: string;
  width: number;
  height: number;
  fps: number;
  dropped: number;
}

type MetaListener = (m: StreamMeta) => void;

interface Entry {
  mirror: Mirror;
  codec: string;
  width: number;
  height: number;
  fps: number;
}

/**
 * Owns the single MessagePort the main process hands us and routes encoded
 * packets to one Mirror (WebGL decoder) per device.
 */
class StreamClient {
  private port: MessagePort | null = null;
  private entries = new Map<string, Entry>();
  private listeners = new Set<MetaListener>();
  private started = false;

  start() {
    if (this.started) return;
    this.started = true;

    bridge.onVideoMeta(({ serial, codec }) => {
      const e = this.entries.get(serial);
      if (e) {
        e.codec = codec;
        e.mirror.setCodec(codec);
      }
    });

    bridge.onVideoSize(({ serial, width, height }) => {
      const e = this.entries.get(serial);
      if (e) {
        e.width = width;
        e.height = height;
        e.mirror.setSize(width, height);
        this.emit(serial);
      }
    });

    window.addEventListener("message", (e) => {
      if (e.data !== "md-port" || !e.ports || !e.ports[0]) return;
      this.port = e.ports[0];
      this.port.onmessage = (ev) => this.onPacket(ev.data);
      this.port.start();
    });

    bridge.postToMain("md-stream-port", null);
  }

  attach(serial: string, canvas: HTMLCanvasElement) {
    this.start();
    let entry = this.entries.get(serial);
    if (!entry) {
      const mirror = new Mirror(serial, canvas, {
        log: () => {},
        syncFrame: () => bridge.syncFrame(),
        onFps: (_s: string, fps: number) => {
          const cur = this.entries.get(serial);
          if (cur) {
            cur.fps = fps;
            this.emit(serial);
          }
        },
      });
      entry = { mirror, codec: "", width: 0, height: 0, fps: 0 };
      this.entries.set(serial, entry);
    } else {
      entry.mirror.canvas = canvas;
    }
    this.emit(serial);
  }

  detach(serial: string) {
    const e = this.entries.get(serial);
    if (!e) return;
    e.mirror.dispose();
    this.entries.delete(serial);
  }

  metaFor(serial: string): StreamMeta | null {
    const e = this.entries.get(serial);
    if (!e) return null;
    return {
      serial,
      codec: e.codec,
      width: e.width,
      height: e.height,
      fps: e.fps,
      dropped: e.mirror.dropped,
    };
  }

  subscribe(fn: MetaListener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(serial: string) {
    const meta = this.metaFor(serial);
    if (!meta) return;
    for (const fn of this.listeners) fn(meta);
  }

  private onPacket(p: { kind?: string; serial?: string; data?: ArrayBuffer; pts?: number; key?: boolean; config?: boolean }) {
    if (!p || !p.data || p.kind === "audio") return;
    const serial = p.serial || "";
    const entry = this.entries.get(serial);
    if (!entry) return;

    if (p.config) {
      entry.mirror.setConfig(new Uint8Array(p.data));
      this.emit(serial);
      return;
    }
    entry.mirror.push(new Uint8Array(p.data), p.pts ?? 0, !!p.key);
  }
}

export const streamClient = new StreamClient();