const bridge = window.api;

window.addEventListener("error", (e) => {
  console.log("ERRSTACK", (e.error && e.error.stack) || e.message);
});
window.addEventListener("unhandledrejection", (e) => {
  console.log("REJECTION", (e.reason && e.reason.stack) || String(e.reason));
});

const deviceListEl = document.getElementById("device-list");
const refreshBtn = document.getElementById("refresh-btn");
const adbStatusEl = document.getElementById("adb-status");
const canvas = document.getElementById("video");
const kbCanvas = document.getElementById("keybinds");
const btnKeybinds = document.getElementById("btn-keybinds");
const placeholderEl = document.getElementById("placeholder");
const connOverlayEl = document.getElementById("conn-overlay");
const connMessageEl = document.getElementById("conn-message");
const toolbarEl = document.getElementById("toolbar");
const fpsEl = document.getElementById("fps-counter");
const logPanel = document.getElementById("log-panel");

const btnDisconnect = document.getElementById("btn-disconnect");
const btnBack = document.getElementById("btn-back");
const btnHome = document.getElementById("btn-home");
const btnRecents = document.getElementById("btn-recents");
const btnRotate = document.getElementById("btn-rotate");
const btnScreen = document.getElementById("btn-screen");

let videoW = 0;
let videoH = 0;
let connected = false;
let sessionToken = 0;
let decoder = null;
let decoderBooting = false;
let decoderCodec = "";
let awaitingKeyframe = false;
let bootstrapPacket = null;
let basePts = null;
let configData = null;
let lastPts = 0;
let fps = 0;
let fpsWindowStart = performance.now();
let fpsCount = 0;
let pendingPackets = [];
let recorder = null;
let recorderReady = false;
let recorderNeedsKey = true;

function splitParameterSets(data) {
  const starts = findStartCodes(data);
  let sps = null;
  let pps = null;
  let vps = null;
  let codec = "avc";
  for (let i = 0; i < starts.length; i++) {
    const st = starts[i];
    let end = i + 1 < starts.length ? starts[i + 1] - 3 : data.length;
    while (end > st && data[end - 1] === 0) end--;
    const hevcType = (data[st] >> 1) & 0x3f;
    const avcType = data[st] & 0x1f;
    if (hevcType === 32 && !vps) vps = data.slice(st, end);
    if (hevcType === 34 && !pps) pps = data.slice(st, end);
    if (hevcType === 33 && !sps) {
      sps = data.slice(st, end);
      codec = "hev";
    }
    if (avcType === 7 && !sps && !vps) {
      sps = data.slice(st, end);
      codec = "avc";
    }
    if (avcType === 8 && !pps) pps = data.slice(st, end);
  }
  const ptl = codec === "hev" && sps ? hevcProfileTierLevel(sps) : null;
  return { sps, pps, vps, codec, ptl };
}

function hevcProfileTierLevel(sps) {
  const r = rbspFrom(sps, 2);
  if (r.length < 13) return null;
  let compat = 0;
  for (let k = 0; k < 4; k++) compat = compat * 256 + r[2 + k];
  return {
    profileSpace: (r[1] >> 6) & 0x03,
    tier: (r[1] >> 5) & 0x01,
    profileIdc: r[1] & 0x1f,
    compat: compat >>> 0,
    constraints: Array.from(r.slice(6, 12)),
    levelIdc: r[12],
  };
}

function recordSample(data, pts, key) {
  if (!recorder || !recorderReady) return;
  if (recorderNeedsKey && !key) return;
  if (recorderNeedsKey && key) {
    recorderNeedsKey = false;
    try {
      bridge.syncFrame();
    } catch {}
  }
  recorder.addSample(data, pts, key);
}

async function startRecording() {
  recorder = new MP4Writer({ width: videoW, height: videoH });
  recorderReady = false;
  recorderNeedsKey = true;
  try {
    bridge.syncFrame();
  } catch {}
  if (configData) {
    const ps = splitParameterSets(configData);
    recorder.setParameterSets(ps.sps, ps.pps, ps.codec, { vps: ps.vps, ptl: ps.ptl });
    recorderReady = !!(ps.sps && ps.pps);
    console.log("recording params: codec=" + ps.codec + " sps=" + (ps.sps ? ps.sps.length : 0) + " pps=" + (ps.pps ? ps.pps.length : 0) + " vps=" + (ps.vps ? ps.vps.length : 0));
  } else {
    console.log("recording params: no configData yet");
  }
  btnRecord.classList.add("recording");
  console.log("recording started ready=" + recorderReady + " sps=" + !!(recorder && recorder.sps) + " " + videoW + "x" + videoH);
  log("recording started");
}

async function stopRecording() {
  btnRecord.classList.remove("recording");
  if (!recorder) return;
  const bytes = recorder.finalize();
  const samples = recorder.samples.length;
  recorder = null;
  if (!bytes) {
    console.log("recording produced no frames (samples=" + samples + ")");
    log("recording produced no frames", true);
    return;
  }
  console.log("recording finalizing samples=" + samples);
  const res = await bridge.saveRecording(bytes.buffer);
  console.log("recording save result: " + JSON.stringify(res));
  if (res && res.ok) log(`recording saved (${samples} frames): ${res.file}`);
  else log(`recording failed: ${res && res.error}`, true);
}
let flushScheduled = false;
let screenOn = true;

function log(line, isErr) {
  const div = document.createElement("div");
  div.className = "log-line" + (isErr ? " err" : "");
  div.textContent = line;
  logPanel.appendChild(div);
  while (logPanel.childElementCount > 500) logPanel.removeChild(logPanel.firstChild);
  logPanel.scrollTop = logPanel.scrollHeight;
}

function setConnMsg(msg) {
  connMessageEl.innerHTML = msg;
  connOverlayEl.classList.remove("hidden");
}

function hideConn() {
  connOverlayEl.classList.add("hidden");
}

let lastCodecId = "";

function findStartCodes(data) {
  const starts = [];
  for (let i = 0; i + 2 < data.length; i++) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
      starts.push(i + 3);
      i += 2;
    }
  }
  return starts;
}

function parseSpsCodecString(sampleData) {
  const data = sampleData instanceof Uint8Array ? sampleData : sampleData.data;
  const starts = findStartCodes(data);
  for (const s of starts) {
    if (s >= data.length) continue;
    const nalType = data[s] & 0x1f;
    if (nalType !== 7) continue;
    const profile = data[s + 1];
    const constraints = data[s + 2];
    const level = data[s + 3];
    if (profile === undefined || constraints === undefined || level === undefined) continue;
    const hex = (n) => n.toString(16).toUpperCase().padStart(2, "0");
    return `avc1.${hex(profile)}${hex(constraints)}${hex(level)}`;
  }
  return null;
}

function rbspFrom(data, start) {
  const out = [];
  for (let i = start; i < data.length; i++) {
    if (i >= start + 2 && data[i] === 0x03 && data[i - 1] === 0 && data[i - 2] === 0 && data[i + 1] <= 0x03) {
      continue;
    }
    out.push(data[i]);
  }
  return out;
}

function parseHevcCodecString(sampleData) {
  const data = sampleData instanceof Uint8Array ? sampleData : sampleData.data;
  const starts = findStartCodes(data);
  const hevcType = (b) => (b >> 1) & 0x3f;
  let sps = -1;
  for (const s of starts) {
    if (s < data.length && hevcType(data[s]) === 33) {
      sps = s;
      break;
    }
  }
  if (sps < 0) return null;

  const r = rbspFrom(data, sps + 2);
  if (r.length < 13) return null;

  const maxSubLayersMinus1 = (r[0] >> 4) & 0x07;

  const generalProfileSpace = (r[1] >> 6) & 0x03;
  const generalTierFlag = (r[1] >> 5) & 0x01;
  const generalProfileIdc = r[1] & 0x1f;

  let compat = 0;
  for (let k = 0; k < 4; k++) compat = compat * 256 + r[2 + k];
  compat = compat >>> 0;

  const constraints = r.slice(6, 12);
  const generalLevelIdc = r[12];

  let i = 13;
  for (let l = 0; l < maxSubLayersMinus1; l++) {
    const flags = i < r.length ? r[i] : 0;
    i += 1;
    if (l < 4) i += 1;
    if (flags & 0x80) i += 4;
    if (flags & 0x40) i += 3;
    if (l < 4) i += 1;
  }

  let reversedCompat = 0;
  for (let k = 0; k < 32; k++) reversedCompat = (reversedCompat * 2) + ((compat >>> k) & 1);
  const compatHex = reversedCompat.toString(16).toUpperCase().replace(/^0+(?=.)/, "") || "0";

  const trimmed = constraints.slice();
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === 0) trimmed.pop();
  const constraintField = trimmed.length
    ? trimmed.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(".")
    : "0";

  const profileField = `${generalProfileSpace}${generalProfileIdc}`.replace(/^0(?=\d)/, "");
  const tierField = `${generalTierFlag ? "H" : "L"}${generalLevelIdc}`;
  return `hev1.${profileField}.${compatHex}.${tierField}.${constraintField}`;
}

function ensureDecoder(codecId, sampleData) {
  if (decoder || decoderBooting) return;
  let codecString = null;
  if (codecId === "h264") codecString = parseSpsCodecString({ data: sampleData }) || "avc1.42E01E";
  else if (codecId === "h265" || codecId === "hevc") {
    const parsedHevc = parseHevcCodecString(sampleData);
    window.__hevcDerived = parsedHevc;
    codecString = parsedHevc || "hev1.1.6.L93.B0";
  }
  else if (codecId === "av01") codecString = "av01.0.08M.08";
  if (!codecString) {
    log(`unsupported codec: ${codecId}`, true);
    return;
  }
  decoderBooting = true;
  window.__codec = { id: codecId, derived: codecString };
  VideoDecoder.isConfigSupported({
    codec: codecString,
    optimizeForLatency: true,
    hardwareAcceleration: "no-preference",
  })
    .then((support) => {
      window.__codec.supported = support.supported;
      if (!support.supported) {
        log(`decoder not available for ${codecString}`, true);
        decoderBooting = false;
        return;
      }
      decoder = new VideoDecoder({
        output: (frame) => {
          drawFrame(frame);
          frame.close();
        },
        error: (e) => log(`decoder error: ${e.message}`, true),
      });
      decoder.configure({
        codec: codecString,
        optimizeForLatency: true,
        hardwareAcceleration: "no-preference",
      });
      decoderCodec = codecString;
      decoderBooting = false;
      awaitingKeyframe = true;
      log(`decoder ready (${codecString})`);
      try {
        bridge.syncFrame();
      } catch {}
      if (bootstrapPacket && bootstrapPacket.key) {
        const p = bootstrapPacket;
        bootstrapPacket = null;
        awaitingKeyframe = false;
        enqueuePacket(p);
      }
    })
    .catch((e) => {
      log(`codec support check failed: ${e.message}`, true);
      decoderBooting = false;
    });
}

let gl = null;
let glProgram = null;
let glTexture = null;
let glTexW = 0;
let glTexH = 0;
let glLoc = {};

function initGL() {
  gl = canvas.getContext("webgl2", { alpha: false, antialias: false, desynchronized: true, preserveDrawingBuffer: true });
  if (!gl) return false;
  const vs = `attribute vec2 p;varying vec2 uv;void main(){uv=vec2((p.x+1.0)*0.5,(1.0-p.y)*0.5);gl_Position=vec4(p,0.0,1.0);}`;
  const fs = `precision mediump float;varying vec2 uv;uniform sampler2D tex;void main(){gl_FragColor=texture2D(tex,uv);}`;
  const mk = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return sh;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, mk(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
  glProgram = prog;
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  glLoc.p = gl.getAttribLocation(prog, "p");
  glLoc.tex = gl.getUniformLocation(prog, "tex");
  gl.enableVertexAttribArray(glLoc.p);
  gl.vertexAttribPointer(glLoc.p, 2, gl.FLOAT, false, 0, 0);
  gl.uniform1i(glLoc.tex, 0);
  gl.disable(gl.DEPTH_TEST);
  glTexW = 0;
  glTexH = 0;
  window.__glActive = true;
  return true;
}

function drawFrameGL(frame) {
  if (!gl && !initGL()) return false;
  if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
    canvas.width = frame.displayWidth;
    canvas.height = frame.displayHeight;
    glTexW = 0;
  }
  if (!glTexture || glTexW !== frame.displayWidth || glTexH !== frame.displayHeight) {
    if (!glTexture) {
      glTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, glTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }
    gl.bindTexture(gl.TEXTURE_2D, glTexture);
    glTexW = frame.displayWidth;
    glTexH = frame.displayHeight;
  }
  gl.bindTexture(gl.TEXTURE_2D, glTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, frame);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  if (gl.getError() !== 0) glErrors++;
  glFrames++;
  return true;
}

function drawFrame2D(frame) {
  if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
    canvas.width = frame.displayWidth;
    canvas.height = frame.displayHeight;
  }
  canvas.getContext("2d", { alpha: false, desynchronized: true }).drawImage(frame, 0, 0);
  return true;
}

let useWebGL = true;

let glFrames = 0;
let glErrors = 0;
window.__glStats = () => ({ glFrames, glErrors, webgl: !!gl });

function drawFrame(frame) {
  try {
    if (!(useWebGL ? drawFrameGL(frame) : drawFrame2D(frame))) drawFrame2D(frame);
  } catch (e) {
    glErrors++;
    if (glErrors < 3) console.log("drawFrame failed: " + (e && e.message));
  }
  const rect = canvas.getBoundingClientRect();
  if (kbCanvas && (kbCanvas.width !== Math.round(rect.width) || kbCanvas.height !== Math.round(rect.height))) {
    kbCanvas.width = Math.round(rect.width);
    kbCanvas.height = Math.round(rect.height);
    if (typeof drawKeybinds === "function") drawKeybinds();
  }
}

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  setTimeout(() => {
    flushScheduled = false;
    const toProcess = pendingPackets;
    pendingPackets = [];
    for (const p of toProcess) {
      if (!decoder || decoder.state !== "configured") continue;
      if (basePts === null) basePts = p.pts;
      const ptsMicro = Math.max(p.pts - basePts, lastPts + 1);
      lastPts = ptsMicro;
      try {
        decoder.decode(
          new EncodedVideoChunk({
            type: p.key ? "key" : "delta",
            timestamp: ptsMicro,
            data: p.data,
          })
        );
      } catch (e) {
        log(`decode submit failed: ${e.message}`, true);
      }
    }
    fpsCount += toProcess.length;
    const now = performance.now();
    if (now - fpsWindowStart >= 1000) {
      fps = Math.round((fpsCount * 1000) / (now - fpsWindowStart));
      fpsCount = 0;
      fpsWindowStart = now;
      fpsEl.textContent = fps > 0 ? `${fps} fps` : "";
    }
  }, 16);
}

function mapEventToTouch(e, action) {
  const rect = canvas.getBoundingClientRect();
  if (videoW === 0 || videoH === 0) return;
  const scaleX = rect.width / videoW;
  const scaleY = rect.height / videoH;
  const x = Math.round((e.clientX - rect.left) / scaleX);
  const y = Math.round((e.clientY - rect.top) / scaleY);
  if (x < 0 || y < 0 || x >= videoW || y >= videoH) return;
  bridge.touch(action, x, y, videoW, videoH, e.buttons > 0 || action === 1 ? 1 : 0);
}

const QUALITY_PRESETS = {
  performance: { maxSize: 720, maxFps: 30, videoBitRate: 3_000_000 },
  balanced: { maxSize: 0, maxFps: 60, videoBitRate: 8_000_000 },
  quality: { maxSize: 0, maxFps: 60, videoBitRate: 14_000_000 },
  max: { maxSize: 0, maxFps: 90, videoBitRate: 24_000_000 },
};

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 3000, 5000];
let intentionalDisconnect = false;
let reconnectAttempt = 0;
let lastSerial = null;

let pressing = false;
let lastPoint = { x: 0, y: 0 };

canvas.addEventListener("mousedown", (e) => {
  if (!connected || e.button !== 0) return;
  e.preventDefault();
  pressing = true;
  mapEventToTouch(e, 0);
});
canvas.addEventListener("mousemove", (e) => {
  if (!connected || e.buttons !== 1) return;
  e.preventDefault();
  mapEventToTouch(e, 2);
});
canvas.addEventListener("mouseup", (e) => {
  if (!connected) return;
  mapEventToTouch(e, 1);
  pressing = false;
});
window.addEventListener("mouseup", (e) => {
  if (!pressing || !connected) return;
  pressing = false;
  const rect = canvas.getBoundingClientRect();
  const x = Math.round((e.clientX - rect.left) / (rect.width / videoW));
  const y = Math.round((e.clientY - rect.top) / (rect.height / videoH));
  bridge.touch(1, Math.max(0, Math.min(videoW - 1, x)), Math.max(0, Math.min(videoH - 1, y)), videoW, videoH, 0);
});
canvas.addEventListener(
  "wheel",
  (e) => {
    if (!connected) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) / (rect.width / videoW));
    const y = Math.round((e.clientY - rect.top) / (rect.height / videoH));
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      bridge.pinch(x, y, videoW, videoH, e.deltaY < 0);
      return;
    }
    const v = e.deltaY < 0 ? 1 : -1;
    bridge.scroll(x, y, videoW, videoH, 0, v, 0);
  },
  { passive: false }
);

canvas.addEventListener("keydown", (e) => {
  if (!connected) return;
  handleKey(e, 0);
});
canvas.addEventListener("keyup", (e) => {
  if (!connected) return;
  handleKey(e, 1);
});

function handleKey(e, action) {
  const androidOf = {
    Enter: 66,
    Backspace: 67,
    Tab: 61,
    Escape: 111,
    ArrowUp: 19,
    ArrowDown: 20,
    ArrowLeft: 21,
    ArrowRight: 22,
  };
  if (e.key === "Enter" || e.key === "Backspace" || e.key === "Tab" || e.key === "Escape" || e.key.startsWith("Arrow")) {
    e.preventDefault();
    bridge.key(action, androidOf[e.key] ?? 0, 0);
    return;
  }
  if (e.key.length === 1 && action === 0) {
    e.preventDefault();
    bridge.text(e.key);
  }
}

function makeDeviceElement(d) {
  const el = document.createElement("div");
  el.className = "device-item";
  el.dataset.serial = d.serial;
  const icon = document.createElement("div");
  icon.className = "device-icon";
  icon.textContent = d.serial.includes(":") || d.serial.includes("._tcp") ? "\u26A1" : "\uD83D\uDCF1";
  const info = document.createElement("div");
  info.className = "device-info";
  const name = document.createElement("div");
  name.className = "device-name";
  name.textContent = d.model || d.serial;
  const state = document.createElement("div");
  state.className = "device-state";
  const key = d.state === "device" ? "ok" : d.state === "unauthorized" || d.state === "offline" ? "warn" : "err";
  state.classList.add(key);
  const isWifi = d.serial.includes(":");
  const transport = isWifi ? "wifi" : d.altSerial ? "usb + wifi" : "usb";
  const parts = [d.state === "device" ? "ready" : d.state];
  if (typeof d.battery === "number") parts.push(`${d.battery}%`);
  parts.push(transport);
  state.textContent = parts.join(" · ");
  info.appendChild(name);
  info.appendChild(state);
  if (!d.serial.includes(":") && d.serial !== localStorage.getItem("activeSerial")) {
    const wifiBtn = document.createElement("button");
    wifiBtn.className = "connect-btn";
    wifiBtn.style.marginLeft = "6px";
    wifiBtn.textContent = "WiFi";
    wifiBtn.title = "Switch this phone to wireless debugging";
    wifiBtn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      wifiBtn.disabled = true;
      const res = await bridge.wifiEnable(d.serial);
      if (res && res.ok) {
        log(`${d.model || d.serial}: wireless debugging on at ${res.ip} - unplug the cable`);
        await bridge.wifiConnect(`${res.ip}:5555`).catch(() => {});
        setTimeout(refreshDevices, 2500);
      } else {
        log(`wifi switch failed: ${res && res.error}`, true);
      }
      wifiBtn.disabled = false;
    });
    el.appendChild(wifiBtn);
  }

  const btn = document.createElement("button");
  btn.className = "connect-btn";
  btn.textContent = "Connect";
  btn.disabled = d.state !== "device";
  btn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (connected) {
      doDisconnect();
    } else {
      doConnect(d.serial);
    }
  });
  el.appendChild(icon);
  el.appendChild(info);
  el.appendChild(btn);
  if (connected && localStorage.getItem("activeSerial") === d.serial) {
    el.classList.add("active");
    btn.textContent = "Disconnect";
    btn.classList.add("connected");
  }
  return el;
}

function clearSelection() {
  localStorage.removeItem("activeSerial");
  for (const item of deviceListEl.children) {
    item.classList.remove("active");
    const b = item.querySelector(".connect-btn");
    if (b) {
      b.textContent = "Connect";
      b.classList.remove("connected");
    }
  }
}

async function refreshDevices() {
  try {
    const devices = await bridge.listDevices();
    deviceListEl.textContent = "";
    for (const d of devices) deviceListEl.appendChild(makeDeviceElement(d));
    adbStatusEl.textContent = devices.length
      ? `${devices.length} device(s) \u00b7 adb \u2713`
      : "no device detected";
  } catch (e) {
    adbStatusEl.textContent = "adb unavailable";
  }
}

async function doConnect(serial, isReconnect) {
  const myToken = ++sessionToken;
  lastSerial = serial;
  if (!isReconnect) {
    intentionalDisconnect = false;
    reconnectAttempt = 0;
  }
  localStorage.setItem("activeSerial", serial);
  ensureAudioContext();
  setConnMsg("Connecting&hellip;");
  placeholderEl.classList.add("hidden");
  canvas.classList.add("hidden");
  const preset = QUALITY_PRESETS[qualitySel.value] || QUALITY_PRESETS.balanced;
  const result = await bridge.connect(serial, {
    maxSize: preset.maxSize,
    maxFps: preset.maxFps,
    videoBitRate: preset.videoBitRate,
    videoCodec: codecSel.value === "auto" ? "h265" : codecSel.value,
    audio: audioModeSel.value === "mic",
    stayAwake: true,
    newDisplay: displaySel.value || null,
    clipboardAutosync: true,
  });
if (result.ok) {
    if (myToken !== sessionToken) return;
    connected = true;
    placeholderEl.classList.add("hidden");
    document.title = `${result.hello.deviceName} · MirrorDeck`;
    toolbarEl.classList.remove("hidden");
    canvas.classList.remove("hidden");
    if (typeof loadKeybinds === "function") {
      loadKeybinds();
      setTimeout(drawKeybinds, 300);
    }
    refreshDevices();
    if (videoW > 0) canvas.classList.remove("hidden");
  } else {
    if (myToken !== sessionToken) return;
    connected = false;
    placeholderEl.classList.remove("hidden");
    log(`connection failed: ${result.error}`, true);
    clearSelection();
  }
  hideConn();
}

let reconnectingSetting = false;

async function reconnectWithCurrentSettings() {
  if (reconnectingSetting) return;
  reconnectingSetting = true;
  const serial = lastSerial || localStorage.getItem("activeSerial");
  await doDisconnect();
  if (serial) await doConnect(serial, false);
  reconnectingSetting = false;
}

const doReconnectForAudio = reconnectWithCurrentSettings;
const doReconnectForCodec = reconnectWithCurrentSettings;

async function doDisconnect() {
  intentionalDisconnect = true;
  sessionToken++;
  await bridge.disconnect();
  onClosed();
  refreshDevices();
}

function onClosed() {
  connected = false;
  lastPts = 0;
  basePts = null;
  configData = null;
  bootstrapPacket = null;
  awaitingKeyframe = false;
  resetAudio();
  if (recorder) {
    recorder = null;
    btnRecord.classList.remove("recording");
  }
  if (decoder) {
    try { decoder.close(); } catch {}
    decoder = null;
  }
  if (gl) {
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  } else {
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  }
  toolbarEl.classList.add("hidden");
  canvas.classList.add("hidden");
  placeholderEl.classList.remove("hidden");
  document.title = "MirrorDeck";
  fpsEl.textContent = "";
  clearSelection();
}

const btnShot = document.getElementById("btn-shot");
const audioModeSel = document.getElementById("audio-mode");
const codecSel = document.getElementById("codec-mode");
const btnCapture = document.getElementById("btn-capture");
const btnRecord = document.getElementById("btn-record");
const btnWifi = document.getElementById("btn-wifi");
const displaySel = document.getElementById("display-mode");
const qualitySel = document.getElementById("quality");

function toggleCaptureMode() {
  document.body.classList.toggle("capture-mode");
  const on = document.body.classList.contains("capture-mode");
  log(on ? "capture mode on (chrome hidden - ideal for OBS)" : "capture mode off");
}

window.__recordingToggle = async () => {
  if (recorder) {
    await stopRecording();
    return { recording: false };
  }
  await startRecording();
  return { recording: true };
};

btnWifi.addEventListener("click", async () => {
  const res = await bridge.wifiScan();
  const found = res && res.endpoints ? res.endpoints : [];
  if (!found.length) {
    log("no wireless devices discovered - open Wireless debugging > Pair device with QR code", true);
    return;
  }
  const addr = found[0];
  const joined = await bridge.wifiConnect(addr);
  log(joined && joined.ok ? `connected wirelessly: ${joined.message}` : `wireless connect failed: ${joined && joined.error}`);
  setTimeout(refreshDevices, 2000);
});

btnRecord.addEventListener("click", async () => {
  if (recorder) {
    await stopRecording();
  } else {
    await startRecording();
  }
});

btnCapture.addEventListener("click", toggleCaptureMode);

btnShot.addEventListener("click", async () => {
  const res = await bridge.screenshot();
  if (res && res.ok) log(`screenshot saved: ${res.file}`);
  else log(`screenshot failed: ${res && res.error}`, true);
});

codecSel.addEventListener("change", () => {
  log(`codec: ${codecSel.value === "auto" ? "auto (device picks)" : "h264"}`);
  if (connected) doReconnectForCodec();
});

audioModeSel.addEventListener("change", () => {
  log(audioModeSel.value === "mic"
    ? "audio: microphone - captures ambient sound, NOT game audio (remotesubmix is blocked on this device)"
    : "audio: off");
  if (connected) doReconnectForAudio();
});

qualitySel.addEventListener("change", () => {
  const preset = QUALITY_PRESETS[qualitySel.value];
  if (!preset) return;
  log(`quality: ${qualitySel.value} (${preset.maxFps} fps, ${(preset.videoBitRate / 1e6).toFixed(0)} Mbps)`);
  if (connected) bridge.setVideoParams(preset.videoBitRate, false);
});

btnDisconnect.addEventListener("click", doDisconnect);
btnBack.addEventListener("click", () => bridge.keyPress(4));
btnHome.addEventListener("click", () => bridge.keyPress(3));
btnRecents.addEventListener("click", () => bridge.keyPress(187));
btnRotate.addEventListener("click", () => bridge.rotate());
btnScreen.addEventListener("click", () => {
  screenOn = !screenOn;
  bridge.displayPower(screenOn ? false : true);
});
refreshBtn.addEventListener("click", refreshDevices);

bridge.onVideoMeta((meta) => {
  lastCodecId = meta.codec;
  log(`video codec: ${meta.codec}`);
});
bridge.onVideoSize((size) => {
  videoW = size.width;
  videoH = size.height;
  canvas.classList.remove("hidden");
  log(`video: ${videoW}x${videoH}`);
});
let streamPort = null;

window.addEventListener("message", (e) => {
  if (e.data !== "md-port" || !e.ports || !e.ports[0]) return;
  streamPort = e.ports[0];
  streamPort.onmessage = (ev) => {
    const p = ev.data;
    if (!p || (p.kind !== "video" && p.kind !== "audio")) return;
    handleStreamPacket(p);
  };
  streamPort.start();
});

bridge.postToMain("md-stream-port", null);

const OPUS_SAMPLE_RATE = 48000;
const OPUS_CHANNELS = 2;

let audioCtx = null;
let audioDecoder = null;
let audioNextTime = 0;
let audioUnavailable = false;

function ensureAudioContext() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function resetAudio() {
  audioNextTime = 0;
  audioUnavailable = false;
  if (audioDecoder) {
    try {
      if (audioDecoder.state !== "closed") audioDecoder.close();
    } catch {}
    audioDecoder = null;
  }
}

function scheduleAudioData(audioData) {
  try {
    if (!audioCtx) return;
    const channels = Math.min(audioData.numberOfChannels, OPUS_CHANNELS);
    const frames = audioData.numberOfFrames;
    const buffer = audioCtx.createBuffer(channels, frames, audioData.sampleRate);
    for (let c = 0; c < channels; c++) {
      const out = buffer.getChannelData(c);
      audioData.copyTo(out, { planeIndex: c, format: "f32-planar" });
    }
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(audioCtx.destination);
    if (audioNextTime < audioCtx.currentTime) audioNextTime = audioCtx.currentTime;
    src.start(audioNextTime);
    audioNextTime += buffer.duration;
  } catch (e) {
    log(`audio schedule failed: ${e.message}`, true);
  } finally {
    audioData.close();
  }
}

async function ensureAudioDecoder() {
  if (audioDecoder || audioUnavailable) return;
  ensureAudioContext();
  if (!audioCtx) return;
  if (typeof AudioDecoder === "undefined") {
    audioUnavailable = true;
    log("AudioDecoder unavailable in this runtime", true);
    return;
  }
  try {
    const support = await AudioDecoder.isConfigSupported({
      codec: "opus",
      sampleRate: OPUS_SAMPLE_RATE,
      numberOfChannels: OPUS_CHANNELS,
    });
    if (!support.supported) {
      audioUnavailable = true;
      log("opus decoding not supported here - native decoder needed", true);
      return;
    }
    audioDecoder = new AudioDecoder({
      output: scheduleAudioData,
      error: (e) => log(`audio decoder error: ${e.message}`, true),
    });
    audioDecoder.configure({
      codec: "opus",
      sampleRate: OPUS_SAMPLE_RATE,
      numberOfChannels: OPUS_CHANNELS,
    });
    log("audio ready (opus 48 kHz stereo)");
  } catch (e) {
    audioUnavailable = true;
    log(`audio decoder setup failed: ${e.message}`, true);
  }
}

function handleAudioPacket(p) {
  if (p.config) return;
  const st = (window.__audio = window.__audio || { pkts: 0, state: "none" });
  st.pkts++;
  if (audioCtx) st.ctx = audioCtx.state;
  if (!audioDecoder) {
    if (!audioUnavailable) ensureAudioDecoder();
    return;
  }
  if (audioDecoder.state !== "configured") return;
  try {
    audioDecoder.decode(new EncodedAudioChunk({ type: "key", timestamp: p.pts, data: new Uint8Array(p.data) }));
  } catch (e) {
    log(`audio decode failed: ${e.message}`, true);
  }
}

const MAX_PENDING = 3;
let droppedFrames = 0;

function enqueuePacket(p) {
  pendingPackets.push(p);
  if (pendingPackets.length > MAX_PENDING) {
    pendingPackets.length = 0;
    awaitingKeyframe = true;
    droppedFrames++;
    try {
      bridge.syncFrame();
    } catch {}
    return;
  }
  scheduleFlush();
}

const mirrors = new Map();
let activeMirrorSerial = null;

function tileFor(serial) {
  let t = document.querySelector(`.tile[data-serial="${CSS.escape(serial)}"]`);
  if (!t) {
    const wrap = document.createElement("div");
    wrap.className = "tile";
    wrap.dataset.serial = serial;
    const c = document.createElement("canvas");
    c.width = 9;
    c.height = 16;
    const label = document.createElement("div");
    label.className = "tile-label";
    wrap.appendChild(c);
    wrap.appendChild(label);
    wrap.addEventListener("mousedown", () => setActiveMirror(serial));
    document.getElementById("tiles").appendChild(wrap);
    t = wrap;
  }
  return t;
}

function ensureMirror(serial) {
  let m = mirrors.get(serial);
  if (!m) {
    const tile = tileFor(serial);
    m = new Mirror(serial, tile.querySelector("canvas"), {
      log: (sr, line, isErr) => log(line, isErr),
      syncFrame: () => bridge.syncFrame(),
      onFps: (sr, fps) => {
        if (sr === activeMirrorSerial) fpsEl.textContent = fps > 0 ? `${fps} fps` : "";
      },
    });
    mirrors.set(serial, m);
    layoutTiles();
  }
  return m;
}

function layoutTiles() {
  const tiles = [...mirrors.values()];
  document.body.classList.toggle("tiled", tiles.length > 0);
  document.body.classList.toggle("multi-tile", tiles.length > 1);
  const n = tiles.length;
  if (!n) return;
  const area = document.getElementById("video-area");
  const cols = n === 1 ? 1 : Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const w = Math.floor((area.clientWidth - (cols - 1) * 4) / cols);
  const h = Math.floor((area.clientHeight - (rows - 1) * 4) / rows);
  for (const m of mirrors.values()) {
    const tile = tileFor(m.serial);
    tile.style.width = `${Math.max(80, w)}px`;
    tile.style.height = `${Math.max(80, h)}px`;
  }
}

window.__mirrorStats = () =>
  [...mirrors.values()].map((m) => ({
    serial: m.serial,
    frames: m.frames,
    dropped: m.dropped,
    outputs: m.outputs || 0,
    state: m.decoder ? m.decoder.state : "none",
    pending: m.pending.length,
    awaitingKey: m.awaitingKeyframe,
  }));

function setActiveMirror(serial) {
  activeMirrorSerial = serial;
  for (const [sr, m] of mirrors) {
    tileFor(sr).classList.toggle("active", sr === serial);
  }
  const m = mirrors.get(serial);
  if (m) {
    videoW = m.width;
    videoH = m.height;
  }
  localStorage.setItem("activeSerial", serial);
  bridge.activateMirror(serial);
}

function dropMirror(serial) {
  const m = mirrors.get(serial);
  if (m) {
    m.dispose();
    mirrors.delete(serial);
  }
  const tile = document.querySelector(`.tile[data-serial="${CSS.escape(serial)}"]`);
  if (tile) tile.remove();
  if (activeMirrorSerial === serial) {
    activeMirrorSerial = mirrors.size ? [...mirrors.keys()][0] : null;
  }
  layoutTiles();
}

function handleStreamPacket(p) {
  if (!p || !p.data) return;
  if (p.kind === "audio") {
    handleAudioPacket(p);
    return;
  }
  const mirror = ensureMirror(p.serial || activeMirrorSerial || "");
  mirror.setCodec(lastCodecId);
  const data = new Uint8Array(p.data);
  if (recorder) {
    if (p.config) {
      const ps = splitParameterSets(data);
      recorder.setParameterSets(ps.sps, ps.pps, ps.codec, { vps: ps.vps, ptl: ps.ptl });
      recorder.width = videoW;
      recorder.height = videoH;
      recorderReady = !!(ps.sps && ps.pps);
    } else if (recorderReady) {
      recordSample(data, p.pts, p.key);
    }
  }
  if (p.config) {
    mirror.setConfig(data);
    return;
  }
  mirror.push(data, p.pts, p.key);
}
window.addEventListener("beforeunload", () => {
  intentionalDisconnect = true;
});

bridge.onSessionClosed((payload) => {
  const sr = payload && payload.serial;
  if (sr) dropMirror(sr);
  if (mirrors.size > 0) return;
  onClosed();
  if (intentionalDisconnect || !lastSerial) return;
  const delay = RECONNECT_DELAYS_MS[reconnectAttempt];
  if (delay === undefined) {
    log("giving up after repeated reconnects", true);
    return;
  }
  reconnectAttempt++;
  log(`session lost - reconnecting in ${delay} ms (attempt ${reconnectAttempt})`);
  setTimeout(() => {
    if (intentionalDisconnect) return;
    doConnect(lastSerial, true);
  }, delay);
});
bridge.onDevicesChanged(refreshDevices);
bridge.onLog((line) => log(line));

setInterval(() => {
  if (!connected) refreshDevices();
}, 5000);

refreshDevices();
btnKeybinds.addEventListener("click", () => {
  if (!connected) {
    log("connect a device before editing keybinds", true);
    return;
  }
  setKeybindMode(!kbState.editing);
});

window.addEventListener("keydown", async (e) => {
  if (kbState && kbState.editing && kbState.selected >= 0 && kbState.marks[kbState.selected]) {
    if (e.key !== "Escape" && e.key !== "F11" && !(e.ctrlKey || e.metaKey)) {
      kbState.marks[kbState.selected].key = keyLabel(e);
      saveKeybinds();
      drawKeybinds();
      log(`keybind set: ${kbState.marks[kbState.selected].key}`);
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setKeybindMode(false);
      return;
    }
  } else if (kbState && kbState.marks.length && !kbState.editing && connected && videoW > 0) {
    const label = keyLabel(e);
    const hit = kbState.marks.find((m) => m.key === label);
    if (hit && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      tapAt(hit.nx, hit.ny);
      return;
    }
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "V")) {
    if (connected) {
      e.preventDefault();
      const res = await bridge.pasteClipboard();
      if (res && res.ok) log(`pasted ${res.length} chars to device`);
      else if (res) log(`paste failed: ${res.error}`, true);
    }
    return;
  }
  if (e.key === "F12" || (e.key === "c" && e.altKey)) {
    e.preventDefault();
    toggleCaptureMode();
    return;
  }
  if (e.key === "F11") {
    e.preventDefault();
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  }
});
