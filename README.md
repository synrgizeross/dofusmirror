# DofusMirror

Cross-platform Android screen mirroring and control — Windows, macOS, Linux.

Derived from [TouchMirror](https://github.com/shinzarou-eng/TouchMirror) (MIT), with a
new Electron + Node.js desktop client and the same Apache-2.0 Android engine (scrcpy
fork) running on the phone.

## Status

Work in progress. Current milestone: **end-to-end video mirror**

- ✅ adb device discovery (event-driven via `adb track-devices`)
- ✅ scrcpy wire-protocol client (mux framing, hello handshake, TLV config)
- ✅ Video decoding via WebCodecs with GPU acceleration
- ✅ Mouse → touch injection, scroll, back/home/recents, keyboard text
- ✅ H.264 and H.265 (codec string derived from the stream SPS)
- ✅ Screenshots (PNG, saved to Pictures/DofusMirror)
- ✅ Ctrl+wheel pinch-to-zoom, quality presets, auto-reconnect
- ✅ Bundled adb (self-contained)
- ⏳ Video capture (MP4 remux), multi-device tiles, virtual display UI
- ⏳ Native C addon (zero-copy rendering, native audio path)
- ⏳ Game audio - not possible with the current engine on Android 15+
      (REMOTE_SUBMIX returns empty frames; MIC captures the room only)

## Requirements

- Node.js 20+
- A phone with USB debugging enabled

`adb` is bundled: run `npm run fetch:platform-tools` once to download
platform-tools for macOS, Linux and Windows into `assets/platform-tools/`.
The app prefers that bundled adb, then falls back to the Android SDK
(`ANDROID_HOME` / `ANDROID_SDK_ROOT`) and finally to `adb` on PATH.

## Run

```bash
npm install
npm start
```

First launch is slow on constrained networks (Electron binary download).

## Architecture

```
src/main/          Electron main process (TypeScript)
  adb.ts           adb discovery, device listing, jar push, server spawn
  session.ts       TCP accept + hello handshake + mux demuxer (channels: video/audio/device)
  control.ts       control-message builder (inject touch/key/text, clipboard, display power)
  index.ts         app lifecycle + IPC
src/preload.ts     contextBridge API surface
src/renderer/      UI, WebCodecs video decoder, input mapping
native/            N-API addon (phase 2: audio + zero-copy presentation)
assets/engine.jar  Android-side engine (scrcpy-server fork, Apache-2.0)
```

## License

MIT — see [LICENSE](LICENSE). The bundled engine is Apache-2.0 — see [NOTICE](NOTICE).
