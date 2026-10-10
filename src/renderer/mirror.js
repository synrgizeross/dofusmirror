(function () {  const MAX_PENDING = 6;

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

  function rbspFrom(data, start) {
    const out = [];
    for (let i = start; i < data.length; i++) {
      if (i >= start + 2 && data[i] === 0x03 && data[i - 1] === 0 && data[i - 2] === 0 && data[i + 1] <= 0x03) continue;
      out.push(data[i]);
    }
    return out;
  }

  function parseSpsCodecString(sampleData) {
    const data = sampleData instanceof Uint8Array ? sampleData : sampleData.data;
    const starts = findStartCodes(data);
    for (const s of starts) {
      if (s >= data.length) continue;
      if ((data[s] & 0x1f) !== 7) continue;
      const profile = data[s + 1];
      const constraints = data[s + 2];
      const level = data[s + 3];
      if (profile === undefined || constraints === undefined || level === undefined) continue;
      const hex = (n) => n.toString(16).toUpperCase().padStart(2, "0");
      return `avc1.${hex(profile)}${hex(constraints)}${hex(level)}`;
    }
    return null;
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

  class Mirror {
    constructor(serial, canvas, hooks) {
      this.serial = serial;
      this.canvas = canvas;
      this.hooks = hooks || {};
      this.width = 0;
      this.height = 0;
      this.codec = "";
      this.decoder = null;
      this.decoderBooting = false;
      this.awaitingKeyframe = false;
      this.configData = null;
      this.pending = [];
      this.basePts = null;
      this.lastPts = 0;
      this.flushScheduled = false;
      this.gl = null;
      this.glProgram = null;
      this.glTexture = null;
      this.glTexW = 0;
      this.glTexH = 0;
      this.glLoc = {};
      this.frames = 0;
      this.dropped = 0;
      this.fps = 0;
      this.fpsWindowStart = performance.now();
      this.fpsCount = 0;
    }

    log(line, isErr) {
      if (this.hooks.log) this.hooks.log(this.serial, line, isErr);
    }

    initGL() {
      const gl = this.canvas.getContext("webgl2", {
        alpha: false,
        antialias: false,
        desynchronized: true,
        preserveDrawingBuffer: true,
      });
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
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "p");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1i(gl.getUniformLocation(prog, "tex"), 0);
      gl.disable(gl.DEPTH_TEST);
      this.gl = gl;
      this.glProgram = prog;
      this.glLoc.p = loc;
      this.glTexW = 0;
      this.glTexH = 0;
      return true;
    }

    drawFrameGL(frame) {
      if (!this.gl && !this.initGL()) return false;
      const c = this.canvas;
      if (c.width !== frame.displayWidth || c.height !== frame.displayHeight) {
        c.width = frame.displayWidth;
        c.height = frame.displayHeight;
        this.glTexW = 0;
      }
      const gl = this.gl;
      if (!this.glTexture || this.glTexW !== frame.displayWidth || this.glTexH !== frame.displayHeight) {
        if (!this.glTexture) {
          this.glTexture = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, this.glTexture);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        }
        gl.bindTexture(gl.TEXTURE_2D, this.glTexture);
        this.glTexW = frame.displayWidth;
        this.glTexH = frame.displayHeight;
      }
      gl.bindTexture(gl.TEXTURE_2D, this.glTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, frame);
      gl.viewport(0, 0, c.width, c.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return true;
    }

    drawFrame2D(frame) {
      const c = this.canvas;
      if (c.width !== frame.displayWidth || c.height !== frame.displayHeight) {
        c.width = frame.displayWidth;
        c.height = frame.displayHeight;
      }
      c.getContext("2d", { alpha: false, desynchronized: true }).drawImage(frame, 0, 0);
      return true;
    }

    drawFrame(frame) {
      try {
        if (!this.drawFrameGL(frame)) this.drawFrame2D(frame);
        this.frames++;
      } catch (e) {
        this.log(`draw failed: ${e && e.message}`, true);
      }
    }

    ensureDecoder(codecId, sampleData) {
      if (this.decoder || this.decoderBooting) return;
      let codecString = null;
      if (codecId === "h264" || codecId === "avc") codecString = parseSpsCodecString(sampleData) || "avc1.42E01E";
      else if (codecId === "h265" || codecId === "hevc") codecString = parseHevcCodecString(sampleData) || "hev1.1.6.L93.B0";
      if (!codecString) {
        this.log(`unsupported codec: ${codecId}`, true);
        return;
      }
      this.decoderBooting = true;
      VideoDecoder.isConfigSupported({ codec: codecString, optimizeForLatency: true, hardwareAcceleration: "no-preference" })
        .then((support) => {
          if (!support.supported) {
            this.log(`decoder not available for ${codecString}`, true);
            this.decoderBooting = false;
            return;
          }
          this.decoder = new VideoDecoder({
            output: (frame) => {
              this.drawFrame(frame);
              frame.close();
            },
            error: (e) => this.log(`decoder error: ${e.message}`, true),
          });
          this.decoder.configure({ codec: codecString, optimizeForLatency: true, hardwareAcceleration: "no-preference" });
          this.decoderBooting = false;
          this.awaitingKeyframe = true;
          this.log(`decoder ready (${codecString})`);
        })
        .catch((e) => {
          this.log(`codec support check failed: ${e.message}`, true);
          this.decoderBooting = false;
        });
    }

    requestSyncFrames() {
    if (!this.hooks.syncFrame) return;
    if (this.syncTimer) clearInterval(this.syncTimer);
    let attempts = 0;
    this.syncTimer = setInterval(() => {
      attempts++;
      if ((this.outputs || 0) > 0 || attempts > 12) {
        clearInterval(this.syncTimer);
        this.syncTimer = null;
        return;
      }
      this.hooks.syncFrame();
    }, 800);
  }

  setConfig(data) {
      this.configData = data;
      this.ensureDecoder(this.codec, data);
    }

    setCodec(codec) {
      this.codec = codec;
    }

    setSize(w, h) {
      this.width = w;
      this.height = h;
    }

    push(data, pts, key) {
    if (!this.decoder) {
      this.awaitingKeyframe = true;
      this.ensureDecoder(this.codec, data);
      if (!this.decoder && key) this.bootstrap = { data, pts, key };
      return;
    }
    if (this.awaitingKeyframe && !key) return;
    if (this.configData) {
      const merged = new Uint8Array(this.configData.length + data.length);
      merged.set(this.configData, 0);
      merged.set(data, this.configData.length);
      data = merged;
      this.configData = null;
    }
    this.awaitingKeyframe = false;
    this.pending.push({ data, pts, key });
    if (this.pending.length > MAX_PENDING) {
      this.pending.length = 0;
      this.awaitingKeyframe = true;
      this.dropped++;
      if (this.hooks.syncFrame) this.hooks.syncFrame();
      return;
    }
    this.scheduleFlush();
  }

  scheduleFlush() {
      if (this.flushScheduled) return;
      this.flushScheduled = true;
      setTimeout(() => {
        this.flushScheduled = false;
        const batch = this.pending;
        this.pending = [];
        if (!this.decoder || this.decoder.state !== "configured") return;
        if (this.basePts === null) this.basePts = batch.length ? batch[0].pts : 0;
        for (const p of batch) {
          const pts = Math.max(p.pts - this.basePts, this.lastPts + 1);
          this.lastPts = pts;
          try {
            this.decoder.decode(
              new EncodedVideoChunk({ type: p.key ? "key" : "delta", timestamp: pts, data: p.data })
            );
          } catch (e) {
            this.log(`decode submit failed: ${e.message}`, true);
          }
        }
        this.fpsCount += batch.length;
        const now = performance.now();
        if (now - this.fpsWindowStart >= 1000) {
          this.fps = Math.round((this.fpsCount * 1000) / (now - this.fpsWindowStart));
          this.fpsCount = 0;
          this.fpsWindowStart = now;
        }
        if (this.hooks.onFps) this.hooks.onFps(this.serial, this.fps);
      }, 16);
    }

    clear() {
      if (this.decoder) {
        try {
          if (this.decoder.state !== "closed") this.decoder.close();
        } catch {}
        this.decoder = null;
      }
      this.pending.length = 0;
      this.configData = null;
      this.awaitingKeyframe = false;
      this.basePts = null;
      if (this.gl) {
        this.gl.clearColor(0, 0, 0, 1);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
      }
    }

    dispose() {
      this.clear();
      this.gl = null;
      this.glProgram = null;
      this.glTexture = null;
    }
  }


  if (typeof module !== "undefined" && module.exports) { module.exports = { Mirror }; }
  else { window.Mirror = Mirror; }
})();