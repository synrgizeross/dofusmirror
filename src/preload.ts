import { contextBridge, ipcRenderer } from "electron";

const api = {
  listDevices: () => ipcRenderer.invoke("devices:list"),
  adbInfo: () => ipcRenderer.invoke("adb:info"),
  diagnostics: () => ipcRenderer.invoke("diagnostics:run"),
  restartAdb: () => ipcRenderer.invoke("adb:restart"),
  connect: (serial: string, options: object) => ipcRenderer.invoke("session:connect", serial, options),
  disconnect: (serial?: string) => ipcRenderer.invoke("session:disconnect", serial),
  listApps: (serial: string) => ipcRenderer.invoke("apps:list", serial),
  launchApp: (serial: string, pkg: string, activity?: string) =>
    ipcRenderer.invoke("apps:launch", serial, pkg, activity),
  listMirrors: () => ipcRenderer.invoke("mirrors:list"),
  activateMirror: (serial: string) => ipcRenderer.invoke("mirrors:activate", serial),
  touch: (action: number, x: number, y: number, w: number, h: number, pressure: number) =>
    ipcRenderer.invoke("touch", action, x, y, w, h, pressure),
  scroll: (x: number, y: number, w: number, h: number, hv: number, vv: number, buttons: number) =>
    ipcRenderer.invoke("scroll", x, y, w, h, hv, vv, buttons),
  key: (action: number, keycode: number, metastate: number) => ipcRenderer.invoke("key", action, keycode, metastate),
  keyPress: (keycode: number, metastate: number) => ipcRenderer.invoke("keyPress", keycode, metastate),
  text: (t: string) => ipcRenderer.invoke("text", t),
  displayPower: (on: boolean) => ipcRenderer.invoke("displayPower", on),
  rotate: () => ipcRenderer.invoke("rotate"),
  syncFrame: () => ipcRenderer.invoke("syncFrame"),
  videoSizeNow: () => ipcRenderer.invoke("videoSizeNow"),

  pinch: (cx: number, cy: number, w: number, h: number, zoomIn: boolean) =>
    ipcRenderer.invoke("pinch", cx, cy, w, h, zoomIn),
  screenshot: () => ipcRenderer.invoke("screenshot"),
  pasteClipboard: () => ipcRenderer.invoke("pasteClipboard"),
  wifiEnable: (serial: string) => ipcRenderer.invoke("wifi:enable", serial),
  wifiScan: () => ipcRenderer.invoke("wifi:scan"),
  wifiConnect: (hostPort: string) => ipcRenderer.invoke("wifi:connect", hostPort),
  wifiPair: (hostPort: string, code: string) => ipcRenderer.invoke("wifi:pair", hostPort, code),
  saveRecording: (bytes: ArrayBuffer) => ipcRenderer.invoke("recording:save", bytes),
  setVideoParams: (bitRate: number, suspend: boolean) => ipcRenderer.invoke("setVideoParams", bitRate, suspend),

  postToMain: (channel: string, message: unknown, transfer?: unknown[]) =>
    ipcRenderer.postMessage(channel, message, transfer as any),
  onFromMain: (channel: string, cb: (msg: unknown) => void) => {
    ipcRenderer.on(channel, (_e, msg) => cb(msg));
  },

  onDevicesChanged: (cb: () => void) => {
    ipcRenderer.on("devicesChanged", cb);
  },
  onVideoMeta: (cb: (meta: { serial: string; codec: string }) => void) => {
    ipcRenderer.on("videoMeta", (_e, meta) => cb(meta));
  },
  onVideoSize: (cb: (size: { serial: string; width: number; height: number }) => void) => {
    ipcRenderer.on("videoSize", (_e, size) => cb(size));
  },
  onMirrors: (cb: (mirrors: unknown[]) => void) => {
    ipcRenderer.on("mirrors", (_e, m) => cb(m));
  },
  onSessionClosed: (cb: (payload: { serial: string }) => void) => {
    ipcRenderer.on("sessionClosed", (_e, p) => cb(p));
  },
  onLog: (cb: (payload: { serial: string; line: string }) => void) => {
    ipcRenderer.on("log", (_e, p) => cb(p));
  },
  onClipboard: (cb: (payload: { serial: string; text: string }) => void) => {
    ipcRenderer.on("clipboard", (_e, p) => cb(p));
  },
};

ipcRenderer.on("md-stream-port", (event) => {
  const port = event.ports[0];
  if (port) {
    (window as unknown as { postMessage: (m: string, t: string, x: unknown[]) => void }).postMessage("md-port", "*", [port]);
  }
});

contextBridge.exposeInMainWorld("api", api);