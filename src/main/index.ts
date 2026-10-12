import { app, BrowserWindow, ipcMain, dialog, clipboard, Menu, nativeTheme, MessageChannelMain } from "electron";
import * as path from "path";
import * as fs from "fs";
import { APP_NAME, OVERLAY, TITLE_BAR_HEIGHT } from "./product";
import * as adb from "./adb";
import { MirrorSession, VideoPacket, SessionHello } from "./session";
import { startLocalApi } from "./api";
import { runDiagnostics } from "./diagnostics";
import { listLaunchableApps } from "./apps";
import { EngineOptions, MotionEvent } from "./control";

let mainWindow: BrowserWindow | null = null;
const sessions = new Map<string, MirrorSession>();
let activeSerial: string | null = null;
let untrack: (() => void) | null = null;
let streamPort: Electron.MessagePortMain | null = null;

function postToRenderer(p: VideoPacket, kind: "video" | "audio", serial: string) {
  if (!streamPort) return;
  const src = p.data;
  const ab = src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength) as ArrayBuffer;
  try {
    streamPort.postMessage({ serial, kind, data: ab, pts: p.pts, key: p.isKeyFrame, config: p.isConfig });
  } catch {}
}

const LOG_FILE = "/tmp/dofusmirror-app.log";

function appLog(line: string) {
  try {
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}\n`);
  } catch {}
}

const isDev = process.env.NODE_ENV === "development";

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    title: APP_NAME,
    backgroundColor: "#0a0a0c",
    autoHideMenuBar: true,
    // Custom title bar that keeps native window behaviour:
    // macOS insets its traffic lights; Windows/Linux overlay their native
    // controls (snap layouts, resize, animations all keep working).
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 14, y: 16 } }
      : {
          titleBarStyle: "hidden" as const,
          titleBarOverlay: {
            color: OVERLAY.color,
            symbolColor: OVERLAY.symbolColor,
            height: TITLE_BAR_HEIGHT,
          },
        }),
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.on("console-message", (...args: unknown[]) => {
    const e = args[0] as { level?: string | number; message?: string; lineNumber?: number; sourceId?: string } | undefined;
    if (e && typeof e === "object" && "message" in e) {
      appLog(`[renderer:${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`);
    } else {
      appLog(`[renderer] ${args.map((a) => String(a)).join(" ")}`);
    }
  });
  mainWindow.webContents.on("did-fail-load", (...args: unknown[]) => {
    appLog(`[renderer] load failed ${args.map((a) => String(a)).join(" ")}`);
  });
  mainWindow.webContents.on("preload-error", (_e, preloadPath, err) => {
    appLog(`[preload] error ${preloadPath}: ${(err as Error).message}`);
  });
  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  mainWindow.webContents.on("did-finish-load", () => appLog("[main] renderer loaded"));

  if (process.env.MD_SELFTEST) {
    mainWindow.webContents.on("did-finish-load", () => {
      setTimeout(async () => {
        const wc = mainWindow!.webContents;
        if (process.env.MD_SELFTEST === "shot") {
          try {
            const out = process.env.MD_SHOT_OUT || "/tmp/md-renderer.png";
            const boot = Number(process.env.MD_SHOT_DELAY || 1500);
            await new Promise((r) => setTimeout(r, boot));
            const clicks = (process.env.MD_SHOT_CLICKS || "").split("|").filter(Boolean);
            for (const sel of clicks) {
              await wc.executeJavaScript(
                `(() => {
                  const el = document.querySelector(${JSON.stringify(sel)});
                  if (!el) return false;
                  const opts = { bubbles: true, cancelable: true, composed: true,
                    clientX: el.getBoundingClientRect().left + 4,
                    clientY: el.getBoundingClientRect().top + 4 };
                  el.focus();
                  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
                    el.dispatchEvent(new PointerEvent(type, opts));
                  }
                  return true;
                })()`,
              );
              await new Promise((r) => setTimeout(r, 900));
            }
            await new Promise((r) => setTimeout(r, Number(process.env.MD_SHOT_SETTLE || 0)));
            if (process.env.MD_SHOT_TAP) {
              const [tx, ty] = process.env.MD_SHOT_TAP.split(",").map(Number);
              const r = (await wc.executeJavaScript(`(() => {
                window.__taps = [];
                const orig = window.api.touch;
                window.api.touch = (...a) => { window.__taps.push(a); return orig(...a); };
                const c = document.querySelector("canvas[data-painted='true']");
                if (!c) return "no painted canvas";
                const r = c.getBoundingClientRect();
                const opts = { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0, buttons: 1,
                  clientX: r.left + r.width * ${tx}, clientY: r.top + r.height * ${ty} };
                c.dispatchEvent(new PointerEvent("pointerdown", opts));
                c.dispatchEvent(new PointerEvent("pointermove", opts));
                c.dispatchEvent(new PointerEvent("pointerup", { ...opts, buttons: 0 }));
                return JSON.stringify({ rect: [Math.round(r.width), Math.round(r.height)], taps: window.__taps });
              })()`)) as string;
              appLog(`[tap-selftest] ${r}`);
              await new Promise((r2) => setTimeout(r2, 2500));
            }
            for (const key of (process.env.MD_SHOT_KEYS || "").split(",").filter(Boolean)) {
              await wc.executeJavaScript(
                `window.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, bubbles: true }))`,
              );
              await new Promise((r) => setTimeout(r, 500));
            }
            const info = (await wc.executeJavaScript(`JSON.stringify({
              root: !!document.getElementById('root'),
              nodes: document.getElementById('root') ? document.getElementById('root').childElementCount : 0,
              text: (document.body.innerText || '').slice(0, 600)
            })`)) as string;
            appLog(`[shot-selftest] dom ${info}`);
            const img = await wc.capturePage();
            fs.writeFileSync(out, img.toPNG());
            appLog(`[shot-selftest] wrote ${out}`);
          } catch (e) {
            appLog(`[shot-selftest] failed ${(e as Error).message}`);
          }
          app.quit();
          return;
        }
        if (["connect", "record", "keybind", "diag"].includes(process.env.MD_SELFTEST || "")) {
          try {
            await wc.executeJavaScript(`(() => {
              const codec = document.getElementById('codec-mode');
              if (codec) codec.value = '${process.env.MD_CODEC || "h264"}';
              const disp = document.getElementById('display-mode');
              const wanted = '${process.env.MD_DISPLAY || ""}';
              if (disp && wanted) disp.value = wanted;
              const btn = document.querySelector('.device-item .connect-btn');
              if (!btn) return 'no connect button';
              btn.click();
              return 'clicked connect';
            })()`);
          } catch (e) {
            appLog(`[selftest] connect click failed ${(e as Error).message}`);
          }
        }
        await new Promise((r) => setTimeout(r, 14000));
        if (process.env.MD_SELFTEST === "diag") {
          try {
            await wc.executeJavaScript(`document.getElementById('btn-diag').click()`);
            await new Promise((r) => setTimeout(r, 4000));
            const r = (await wc.executeJavaScript(`(() => {
              const p = document.getElementById('diag-panel');
              const score = p.querySelector('.diag-score');
              const rows = [...p.querySelectorAll('.diag-row')].map(x => x.textContent.trim());
              return JSON.stringify({ open: !p.classList.contains('hidden'), score: score ? score.textContent : null, rows });
            })()`)) as { open: boolean; score: string; rows: string[] };
            appLog(`[diag-selftest] ${JSON.stringify(r)}`);
          } catch (e) {
            appLog(`[diag-selftest] failed ${(e as Error).message}`);
          }
        }
        if (process.env.MD_SELFTEST === "keybind") {
          try {
            const r = (await wc.executeJavaScript(`(() => {
              document.getElementById('btn-keybinds').click();
              const c = document.getElementById('keybinds');
              const rect = c.getBoundingClientRect();
              const cx = rect.left + rect.width * 0.5, cy = rect.top + rect.height * 0.5;
              const opts = { bubbles: true, clientX: cx, clientY: cy, button: 0 };
              c.dispatchEvent(new MouseEvent('mousedown', opts));
              window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
              window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', bubbles: true }));
              const marks = JSON.parse(localStorage.getItem('keybinds:' + localStorage.getItem('activeSerial')) || '[]');
              document.getElementById('btn-keybinds').click();
              return JSON.stringify({ count: marks.length, key: marks[0] && marks[0].key, editing: kbState.editing });
            })()`)) as { count: number; key: string; editing: boolean };
            appLog(`[keybind-selftest] ${JSON.stringify(r)}`);
          } catch (e) {
            appLog(`[keybind-selftest] failed ${(e as Error).message}`);
          }
          await new Promise((r2) => setTimeout(r2, 600));
          await wc.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', bubbles: true }))`);
          await new Promise((r2) => setTimeout(r2, 600));
        }

        if (process.env.MD_SELFTEST === "record") {
          try {
            await wc.executeJavaScript(`document.getElementById('btn-record').click()`);
            await new Promise((r) => setTimeout(r, 7000));
            await wc.executeJavaScript(`document.getElementById('btn-record').click()`);
            await new Promise((r) => setTimeout(r, 1500));
          } catch (e) {
            appLog(`[selftest] record failed ${(e as Error).message}`);
          }
        }
        if (process.env.MD_SELFTEST === "connect") {
          try {
            await wc.executeJavaScript(`(() => {
              const c = document.getElementById('video');
              const r = c.getBoundingClientRect();
              const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
              const opts = { bubbles: true, clientX: cx, clientY: cy, button: 0, buttons: 1 };
              c.dispatchEvent(new MouseEvent('mousedown', opts));
              c.dispatchEvent(new MouseEvent('mousemove', opts));
              c.dispatchEvent(new MouseEvent('mouseup', { ...opts, buttons: 0 }));
              return 'synthetic click sent';
            })()`);
            await new Promise((r) => setTimeout(r, 1500));
          } catch (e) {
            appLog(`[selftest] click failed ${(e as Error).message}`);
          }
        }
        try {
          await wc.executeJavaScript(`document.body.classList.add('capture-mode')`);
          const out = await wc.executeJavaScript(`JSON.stringify({
            audio: window.__audio || null,
            codec: window.__codec || null,
            hevcDerived: window.__hevcDerived === undefined ? "n/a" : window.__hevcDerived,
            captureBefore: getComputedStyle(document.getElementById('toolbar')).display,
            clipboardBridge: typeof window.api.pasteClipboard === 'function',
            webgl: window.__glActive === true,
            glStats: typeof window.__glStats === 'function' ? window.__glStats() : null,
            brightness: (() => {
              const avg = (el) => {
                try {
                  const c = document.createElement('canvas');
                  c.width = 32; c.height = 32;
                  const cx = c.getContext('2d');
                  cx.drawImage(el, 0, 0, 32, 32);
                  const d = cx.getImageData(0, 0, 32, 32).data;
                  let sum = 0;
                  for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
                  return Math.round(sum / (d.length / 4) / 3);
                } catch (e) { return 'err:' + e.message; }
              };
              const tile = document.querySelector('.tile canvas');
              const main2 = document.getElementById('video');
              return { tile: tile ? avg(tile) : null, main: main2 ? avg(main2) : null };
            })(),
            canvasW: (document.querySelector('.tile canvas') || document.getElementById('video')).width,
            canvasH: (document.querySelector('.tile canvas') || document.getElementById('video')).height,
            tiles: [...document.querySelectorAll('.tile')].map((t) => t.dataset.serial + ':' + t.className),
            mirrorStats: typeof window.__mirrorStats === 'function' ? window.__mirrorStats() : null,
            fps: document.getElementById('fps-counter').textContent,
            log: [...document.querySelectorAll('.log-line')].slice(-25).map(e => e.textContent)
          })`);
          appLog(`[selftest] ${out}`);
        } catch (e) {
          appLog(`[selftest] probe failed ${(e as Error).message}`);
        }
        await doDisconnect().catch(() => {});
        app.quit();
      }, 2500);
    });
  }
  mainWindow.on("closed", () => (mainWindow = null));
}

function send(channel: string, ...args: unknown[]) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

function engineJarPath(): string {
  const candidates = [
    path.join(process.resourcesPath || "", "engine.jar"),
    path.join(__dirname, "..", "engine.jar"),
    path.join(__dirname, "..", "..", "assets", "engine.jar"),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  throw new Error("engine.jar not found next to the app");
}

async function doConnect(serial: string, options: Partial<EngineOptions>): Promise<SessionHello> {
  const existing = sessions.get(serial);
  if (existing) await doDisconnect(serial);
  const opts: EngineOptions = {
    maxSize: options.maxSize ?? 0,
    maxFps: options.maxFps ?? 60,
    videoBitRate: options.videoBitRate ?? 8_000_000,
    videoCodec: options.videoCodec ?? "h265",
    stayAwake: options.stayAwake ?? false,
    audio: options.audio ?? false,
    newDisplay: options.newDisplay ?? null,
    autoLaunchPackage: options.autoLaunchPackage ?? null,
    clipboardAutosync: options.clipboardAutosync ?? true,
  };
  appLog(`[connect] options ${JSON.stringify(opts)} serial=${serial}`);
  const s = new MirrorSession(serial, opts, engineJarPath());
  sessions.set(serial, s);
  if (!activeSerial) activeSerial = serial;
  s.on("log", (line: string) => send("log", { serial, line }));
  s.on("videoMeta", (meta: { codec: string }) => send("videoMeta", { serial, codec: meta.codec }));
  s.on("videoSize", (w: number, h: number) => send("videoSize", { serial, width: w, height: h }));
  s.on("videoPacket", (p: VideoPacket) => postToRenderer(p, "video", serial));
  s.on("audioPacket", (p: VideoPacket) => postToRenderer(p, "audio", serial));
  s.on("clipboard", (text: string) => {
    if (activeSerial === serial) {
      try {
        clipboard.writeText(text);
        appLog("[clipboard] copied from device");
      } catch {}
    }
    send("clipboard", { serial, text });
  });
  s.on("disconnected", () => {
    if (sessions.get(serial) !== s) return;
    sessions.delete(serial);
    if (activeSerial === serial) {
      activeSerial = sessions.keys().next().value ?? null;
    }
    send("sessionClosed", { serial });
  });
  const hello = await s.start();
  send("mirrors", listMirrors());
  return hello;
}

function listMirrors() {
  return [...sessions.values()].map((s, index) => ({
    index,
    serial: (s as unknown as { serial: string }).serial,
    device: s.deviceName,
    width: s.videoWidth,
    height: s.videoHeight,
    codec: s.videoCodecId,
    active: (s as unknown as { serial: string }).serial === activeSerial,
  }));
}

function doActivate(serial: string) {
  if (!sessions.has(serial)) return false;
  activeSerial = serial;
  send("mirrors", listMirrors());
  return true;
}

async function doDisconnect(serial?: string) {
  const target = serial ?? activeSerial;
  if (!target) return;
  const s = sessions.get(target);
  if (!s) return;
  sessions.delete(target);
  if (activeSerial === target) activeSerial = sessions.keys().next().value ?? null;
  await s.disconnect();
  send("mirrors", listMirrors());
}


ipcMain.handle("mirrors:list", async () => listMirrors());

ipcMain.handle("mirrors:activate", async (_e, serial: string) => ({ ok: doActivate(serial) }));

ipcMain.on("md-stream-port", (e) => {
  try {
    const { port1, port2 } = new MessageChannelMain();
    streamPort = port2;
    streamPort.on("close", () => (streamPort = null));
    e.sender.postMessage("md-stream-port", null, [port1]);
    appLog("[main] stream port posted to renderer");
  } catch (err) {
    appLog(`[main] stream port handoff failed: ${(err as Error).stack || String(err)}`);
  }
});

ipcMain.handle("devices:list", async () => {
  try {
    const adbPath = adb.findAdb();
    const devices = await adb.listDevices();
    appLog(`[main] devices:list adb=${adbPath} count=${devices.length} ${JSON.stringify(devices)}`);
    return devices;
  } catch (e) {
    appLog(`[main] devices:list FAILED ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
});

ipcMain.handle("apps:list", async (_e, serial: string) => {
  if (!serial) return [];
  try {
    const apps = await listLaunchableApps(serial);
    appLog(`[main] apps:list serial=${serial} count=${apps.length}`);
    return apps;
  } catch (e) {
    appLog(`[main] apps:list FAILED ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
});

ipcMain.handle("apps:launch", async (_e, serial: string, pkg: string, activity?: string) => {
  const target = activity && activity.includes("/") ? activity : `${pkg}/.MainActivity`;
  const cmd = activity ? `am start -n ${target}` : `monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`;
  try {
    const out = await adb.runShell(serial, cmd, 20000);
    appLog(`[main] apps:launch ${target} -> ${out.trim().split("\n")[0]}`);
    return { ok: true, out };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    appLog(`[main] apps:launch FAILED ${msg}`);
    return { ok: false, error: msg };
  }
});

ipcMain.handle("wifi:enable", async (_e, serial: string) => {
  try {
    const ip = await adb.enableWifi(serial);
    return { ok: true, ip };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});

ipcMain.handle("wifi:scan", async () => {
  try {
    return { ok: true, endpoints: await adb.listWirelessEndpoints() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), endpoints: [] };
  }
});

ipcMain.handle("wifi:connect", async (_e, hostPort: string) => {
  try {
    return { ok: true, message: await adb.wirelessConnect(hostPort) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});

ipcMain.handle("wifi:pair", async (_e, hostPort: string, code: string) => {
  try {
    return { ok: true, message: await adb.wirelessPair(hostPort, code) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});

ipcMain.handle("diagnostics:run", async () => runDiagnostics());

ipcMain.handle("adb:restart", async () => {
  try {
    await adb.restartServer();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});

ipcMain.handle("adb:info", () => {
  const p = adb.findAdb();
  return { path: p };
});

ipcMain.handle("session:connect", async (_e, serial: string, options: Partial<EngineOptions>) => {
  try {
    const hello = await doConnect(serial, options);
    return { ok: true, hello };
  } catch (e) {
    await doDisconnect().catch(() => {});
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});

function activeSession(): MirrorSession | null {
  if (!activeSerial) return null;
  return sessions.get(activeSerial) ?? null;
}

ipcMain.handle("pasteClipboard", () => {
  const session = activeSession();
  if (!session) return { ok: false, error: "no session" };
  try {
    const text = clipboard.readText();
    if (!text) return { ok: false, error: "clipboard empty" };
    session.controlChannel.injectText(text);
    return { ok: true, length: text.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});

ipcMain.handle("setVideoParams", (_e, bitRate: number, suspend: boolean) => {
  const session = activeSession();
  if (!session) return;
  try {
    session.controlChannel.setVideoParams(bitRate, suspend);
  } catch {}
});

ipcMain.handle("pinch", (_e, cx: number, cy: number, w: number, h: number, zoomIn: boolean) => {
  const session = activeSession();
  if (!session) return;
  try {
    session.controlChannel.pinch(cx, cy, w, h, zoomIn);
  } catch {}
});

async function captureScreenshot(): Promise<{ ok: boolean; file?: string; error?: string }> {
  if (!mainWindow) return { ok: false, error: "no window" };
  try {
    const image = await mainWindow.webContents.capturePage();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const dir = path.join(app.getPath("pictures"), APP_NAME);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${APP_NAME}-${stamp}.png`);
    fs.writeFileSync(file, image.toPNG());
    return { ok: true, file };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

ipcMain.handle("screenshot", async () => captureScreenshot());

ipcMain.handle("recording:save", async (_e, bytes: ArrayBuffer) => {
  if (!bytes || !bytes.byteLength) return { ok: false, error: "empty recording" };
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const dir = path.join(app.getPath("videos"), APP_NAME);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${APP_NAME}-${stamp}.mp4`);
    fs.writeFileSync(file, Buffer.from(bytes));
    appLog(`[recording] saved ${file} (${bytes.byteLength} bytes)`);
    return { ok: true, file };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});

ipcMain.handle("session:disconnect", async () => {
  await doDisconnect();
  return { ok: true };
});

ipcMain.handle("touch", (_e, action: number, x: number, y: number, w: number, h: number, pressure: number) => {
  appLog(`[touch] action=${action} x=${x} y=${y} w=${w} h=${h} p=${pressure}`);
  const session = activeSession();
  if (!session) return;
  try {
    session.controlChannel.injectTouch(
      action,
      MotionEvent.PointerIdMouse,
      x,
      y,
      w,
      h,
      pressure,
      action === MotionEvent.ActionUp ? 0 : MotionEvent.ButtonPrimary,
      action === MotionEvent.ActionUp || action === MotionEvent.ActionDown ? 0 : MotionEvent.ButtonPrimary
    );
  } catch {}
});

ipcMain.handle("scroll", (_e, x: number, y: number, w: number, h: number, hv: number, vv: number, buttons: number) => {
  const session = activeSession();
  if (!session) return;
  try {
    session.controlChannel.injectScroll(x, y, w, h, hv, vv, buttons);
  } catch {}
});

ipcMain.handle("key", (_e, action: number, keycode: number, metastate: number) => {
  const session = activeSession();
  if (!session) return;
  try {
    session.controlChannel.injectKey(action, keycode, 0, metastate);
  } catch {}
});

ipcMain.handle("keyPress", (_e, keycode: number, metastate: number) => {
  const session = activeSession();
  if (!session) return;
  try {
    session.controlChannel.injectKeyPress(keycode, metastate);
  } catch {}
});

ipcMain.handle("text", (_e, text: string) => {
  const session = activeSession();
  if (!session) return;
  try {
    session.controlChannel.injectText(text);
  } catch {}
});

ipcMain.handle("displayPower", (_e, on: boolean) => {
  const session = activeSession();
  if (!session) return;
  try {
    session.controlChannel.setDisplayPower(on);
  } catch {}
});

ipcMain.handle("rotate", () => {
  const session = activeSession();
  if (!session) return;
  try {
    session.controlChannel.sendSimple(0x25);
  } catch {}
});

ipcMain.handle("syncFrame", () => {
  const session = activeSession();
  if (!session) return;
  try {
    session.controlChannel.sendSimple(0x33);
  } catch {}
});

ipcMain.handle("videoSizeNow", () => {
  const session = activeSession();
  if (!session) return null;
  return { width: session.videoWidth, height: session.videoHeight };
});

ipcMain.handle("dialog:pickGif", async () => {
  if (!mainWindow) return null;
  const r = await dialog.showOpenDialog(mainWindow, { properties: ["openFile"] });
  return r.canceled ? null : r.filePaths[0];
});

app.whenReady().then(async () => {
  // Keep native chrome dark so Windows window borders/menus match the UI.
  nativeTheme.themeSource = "dark";
  if (process.platform !== "darwin") Menu.setApplicationMenu(null);
  createWindow();
  try {
    const api = await startLocalApi({
      listDevices: () => adb.listDevices(),
      connect: async (serial) => {
        try {
          const hello = await doConnect(serial, {});
          return { ok: true, name: hello.deviceName };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },
      disconnect: () => doDisconnect(),
      activateMirror: async () => {},
      recordToggle: async () => {
        if (!mainWindow) return { recording: false };
        try {
          const r = (await mainWindow.webContents.executeJavaScript("window.__recordingToggle()")) as {
            recording: boolean;
          };
          return r;
        } catch {
          return { recording: false };
        }
      },
      screenshot: () => captureScreenshot(),
      status: () => {
        const active = activeSession();
        return {
          app: APP_NAME,
          connected: !!active,
          device: active?.deviceName ?? null,
          serial: activeSerial,
          video: active ? { width: active.videoWidth, height: active.videoHeight, codec: active.videoCodecId } : null,
          mirrors: listMirrors(),
        };
      },
      mirrors: () => listMirrors(),
      activate: (serial: string) => ({ ok: doActivate(serial) }),
      disconnectMirror: (serial: string) => doDisconnect(serial),
    });
    appLog(`[api] listening on http://127.0.0.1:${api.port} (token in ~/.${APP_NAME.toLowerCase()})`);
  } catch (e) {
    appLog(`[api] failed to start: ${(e as Error).message}`);
  }
  const stop = adb.trackDevices(() => {
    send("devicesChanged");
  });
  untrack = stop;
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
  else untrack?.();
});

app.on("before-quit", async () => {
  try {
    await doDisconnect();
  } catch {}
});
