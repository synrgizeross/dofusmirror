import { spawn, spawnSync, ChildProcess } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { SERVER_MAIN_CLASS } from "./product";

export interface AdbDevice {
  serial: string;
  model: string;
  state: string;
}

const SERIAL_RE = /^[A-Za-z0-9._:\-]+$/;

let cachedAdb: string | null = null;

function bundledAdbCandidates(): string[] {
  const exe = process.platform === "win32" ? "adb.exe" : "adb";
  const platformDir =
    process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux";
  const roots = [
    path.join(process.resourcesPath || "", "assets", "platform-tools", platformDir),
    path.join(__dirname, "..", "assets", "platform-tools", platformDir),
    path.join(__dirname, "..", "..", "assets", "platform-tools", platformDir),
  ];
  return roots.map((r) => path.join(r, exe));
}

export function findAdb(): string | null {
  if (cachedAdb) return cachedAdb;
  for (const c of bundledAdbCandidates()) {
    if (c && fs.existsSync(c)) {
      try {
        fs.chmodSync(c, 0o755);
      } catch {}
      cachedAdb = c;
      return cachedAdb;
    }
  }
  const candidates: string[] = [];
  if (process.env.ANDROID_HOME) candidates.push(path.join(process.env.ANDROID_HOME, "platform-tools", "adb"));
  if (process.env.ANDROID_SDK_ROOT) candidates.push(path.join(process.env.ANDROID_SDK_ROOT, "platform-tools", "adb"));
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (home) candidates.push(path.join(home, "Library", "Android", "sdk", "platform-tools", "adb"));
  if (home) candidates.push(path.join(home, "AppData", "Local", "Android", "Sdk", "platform-tools", "adb.exe"));
  if (process.platform === "win32") candidates.push(path.join(process.env.LOCALAPPDATA || "", "Android", "Sdk", "platform-tools", "adb.exe"));
  for (const c of candidates) {
    if (c && fs.existsSync(c)) {
      cachedAdb = c;
      return c;
    }
  }
  const w = spawnSync("where", ["adb"], { encoding: "utf8" });
  if (w.status === 0) {
    const first = (w.stdout || "").split(/\r?\n/).find((l) => l.trim() && fs.existsSync(l.trim()));
    if (first) {
      cachedAdb = first.trim();
      return cachedAdb;
    }
  }
  const w2 = spawnSync("which", ["adb"], { encoding: "utf8" });
  if (w2.status === 0 && w2.stdout.trim().startsWith("/")) {
    cachedAdb = w2.stdout.trim();
    return cachedAdb;
  }
  return null;
}

function runAdb(args: string, timeoutMs = 30000): Promise<string> {
  const adb = findAdb();
  if (!adb) return Promise.reject(new Error("adb not found - install Android platform-tools"));
  return new Promise((resolve, reject) => {
    const child = spawn(adb, args.split(/\s+/), { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`adb ${args} timed out`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d.toString("utf8")));
    child.stderr.on("data", (d) => (err += d.toString("utf8")));
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`adb ${args} -> ${code}: ${err.trim()}`));
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

export function parseDevices(output: string): AdbDevice[] {
  const devices: AdbDevice[] = [];
  for (const lineRaw of output.split("\n")) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("List of devices")) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    if (!SERIAL_RE.test(parts[0])) continue;
    const state = parts[1];
    if (!["device", "unauthorized", "offline", "recovery", "sideload", "bootloader"].includes(state)) continue;
    const modelMatch = /model:([^\s]+)/.exec(line);
    const model = modelMatch ? modelMatch[1].replace(/_/g, " ") : "";
    devices.push({ serial: parts[0], model, state });
  }
  return devices;
}

export interface AdbDevice {
  serial: string;
  model: string;
  state: string;
  battery?: number | null;
  hardwareSerial?: string | null;
  altSerial?: string | null;
}

export async function hardwareSerialFor(serial: string): Promise<string | null> {
  try {
    const out = await runAdb(`-s ${serial} shell getprop ro.serialno`, 8000);
    const v = out.trim();
    if (!v || /^(unknown|null)$/i.test(v) || !SERIAL_RE.test(v) || /^0+$/.test(v)) return null;
    return v;
  } catch {
    return null;
  }
}

async function enrich(device: AdbDevice): Promise<AdbDevice> {
  if (device.state !== "device") return device;
  const hw = await hardwareSerialFor(device.serial);
  let battery: number | null = null;
  try {
    const out = await runAdb(`-s ${device.serial} shell dumpsys battery`, 8000);
    const m = /level:\s*(\d+)/.exec(out);
    if (m) battery = parseInt(m[1], 10);
  } catch {}
  return { ...device, hardwareSerial: hw, battery };
}

export async function listDevices(): Promise<AdbDevice[]> {
  const raw = parseDevices(await runAdb("devices -l"));
  const enriched = await Promise.all(raw.map(enrich));

  const byHardware = new Map<string, AdbDevice[]>();
  const result: AdbDevice[] = [];
  for (const d of enriched) {
    const key = d.hardwareSerial ?? "";
    if (!key) {
      result.push(d);
      continue;
    }
    const group = byHardware.get(key) ?? [];
    group.push(d);
    byHardware.set(key, group);
  }
  for (const group of byHardware.values()) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }
    const preferred = group.find((d) => !d.serial.includes(":")) ?? group[0];
    const others = group.filter((d) => d.serial !== preferred.serial).map((d) => d.serial);
    result.push(others.length ? { ...preferred, altSerial: others[0] } : preferred);
  }
  return result;
}

export function trackDevices(onChange: () => void): () => void {
  const adb = findAdb();
  if (!adb) return () => {};
  let stopped = false;
  let child: ChildProcess | null = null;
  const loop = () => {
    if (stopped) return;
    child = spawn(adb, ["track-devices"], { stdio: ["ignore", "pipe", "ignore"] });
    child.stdout?.on("data", () => onChange());
    child.on("close", () => {
      if (!stopped) setTimeout(loop, 2000);
    });
  };
  loop();
  return () => {
    stopped = true;
    if (child) child.kill();
  };
}

export async function reverse(serial: string, socketName: string, localPort: number): Promise<void> {
  await runAdb(`-s ${serial} reverse localabstract:${socketName} tcp:${localPort}`);
}

export async function enableWifi(serial: string): Promise<string> {
  await runAdb(`-s ${serial} tcpip 5555`);
  let ip = "";
  for (let i = 0; i < 10 && !ip; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const out = await runAdb(`-s ${serial} shell ip -o -f inet addr show`, 15000);
      const m = /wlan\d+\s+inet\s+(\d+\.\d+\.\d+\.\d+)/.exec(out);
      if (m) ip = m[1];
    } catch {}
  }
  if (!ip) throw new Error("could not determine the phone WiFi address");
  return ip;
}

export async function wirelessConnect(hostPort: string): Promise<string> {
  if (!/^[A-Za-z0-9._-]{1,253}:\d{1,5}$/.test(hostPort)) throw new Error("invalid host:port");
  const out = await runAdb(`connect ${hostPort}`, 25000);
  if (!/connected to/i.test(out)) throw new Error(out.trim() || "connect failed");
  return out.trim();
}

export async function wirelessPair(hostPort: string, code: string): Promise<string> {
  if (!/^[A-Za-z0-9._-]{1,253}:\d{1,5}$/.test(hostPort)) throw new Error("invalid host:port");
  if (!/^[0-9a-zA-Z]{1,64}$/.test(code)) throw new Error("invalid pairing code");
  const out = await runAdb(`pair ${hostPort} ${code}`, 25000);
  if (!/successfully paired/i.test(out)) throw new Error(out.trim() || "pairing failed");
  return out.trim();
}

export async function listWirelessEndpoints(): Promise<string[]> {
  try {
    const out = await runAdb("mdns services", 20000);
    const list: string[] = [];
    for (const line of out.split("\n")) {
      const m = /^\S+\s+_adb-tls-connect\._tcp\s+(\d+\.\d+\.\d+\.\d+):(\d+)/.exec(line.trim());
      if (m) list.push(`${m[1]}:${m[2]}`);
    }
    return list;
  } catch {
    return [];
  }
}

export async function probe(args: string): Promise<string> {
  try {
    return (await runAdb(args, 15000)).trim();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export async function restartServer(): Promise<void> {
  try {
    await runAdb("kill-server", 10000);
  } catch {}
  try {
    await runAdb("start-server", 20000);
  } catch {}
}

export async function benchmarkFps(serial: string, mb = 4): Promise<number> {
  const adbPath = findAdb();
  if (!adbPath || !serial) return -1;
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(adbPath, ["-s", serial, "exec-out", "dd", "if=/dev/zero", "bs=1M", `count=${mb}`], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let total = 0;
    child.stdout.on("data", (d) => (total += d.length));
    child.on("close", () => {
      const secs = (Date.now() - started) / 1000;
      resolve(secs > 0.1 ? (total * 8) / 1e6 / secs : -1);
    });
    child.on("error", () => resolve(-1));
  });
}

export async function runShell(serial: string, shellCommand: string, timeoutMs = 20000): Promise<string> {
  return runAdb(`-s ${serial} shell ${shellCommand}`, timeoutMs);
}

export async function reverseRemove(serial: string, socketName: string): Promise<void> {
  try {
    await runAdb(`-s ${serial} reverse --remove localabstract:${socketName}`, 4000);
  } catch {}
}

export async function sha256sumRemote(serial: string, remotePath: string): Promise<string | null> {
  try {
    const out = await runAdb(`-s ${serial} shell sha256sum ${remotePath}`, 20000);
    const parts = out.trim().split(/\s+/);
    return parts.length >= 1 && /^[0-9a-f]{64}$/.test(parts[0]) ? parts[0] : null;
  } catch {
    return null;
  }
}

export async function pushFile(serial: string, localPath: string, remotePath: string): Promise<void> {
  if (/["\r\n]/.test(localPath) || /["\r\n]/.test(remotePath)) {
    throw new Error("invalid path for push");
  }
  await runAdb(`-s ${serial} push ${localPath} ${remotePath}`, 300000);
}

export interface ServerProcess {
  proc: ChildProcess;
  onLog: (line: string) => void;
}

export function startServerProcess(serial: string, remoteJar: string, args: string, onLog: (line: string) => void): ServerProcess {
  const adb = findAdb();
  if (!adb) throw new Error("adb not found");
  const proc = spawn(
    adb,
    ["-s", serial, "shell", `CLASSPATH=${remoteJar}`, "app_process", "/", SERVER_MAIN_CLASS, args],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  const forward = (stream: NodeJS.ReadableStream | null) => {
    if (!stream) return;
    let buf = "";
    stream.on("data", (d) => {
      buf += d.toString("utf8");
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line) onLog(line);
      }
    });
  };
  forward(proc.stdout);
  forward(proc.stderr);
  return { proc, onLog };
}
