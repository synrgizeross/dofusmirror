const path = require("path");
const { MirrorSession } = require("../dist/main/session.js");

const serial = process.argv[2];
if (!serial) {
  console.error("usage: node scripts/smoke.js <serial>");
  process.exit(1);
}

const options = {
  maxSize: 0,
  maxFps: 60,
  videoBitRate: 8_000_000,
  videoCodec: "auto",
  stayAwake: false,
  audio: true,
  newDisplay: null,
  autoLaunchPackage: null,
  clipboardAutosync: false,
};

const session = new MirrorSession(serial, options, path.join(__dirname, "..", "dist", "engine.jar"));

let packets = 0;
let keyframes = 0;
let configs = 0;
let bytes = 0;
let firstPts = null;
let lastPts = null;

session.on("log", (l) => console.log("  [log]", l));
session.on("videoMeta", (m) => console.log("  codec:", m.codec));
session.on("videoSize", (w, h) => console.log("  size:", `${w}x${h}`));
session.on("videoPacket", (p) => {
  packets++;
  bytes += p.data.length;
  if (p.isConfig) configs++;
  if (p.isKeyFrame) keyframes++;
  if (firstPts === null) firstPts = p.pts;
  lastPts = p.pts;
});

session
  .start()
  .then(async (hello) => {
    console.log("HELLO OK:", JSON.stringify(hello));
    console.log("caps: 0x" + session.caps.toString(16));
    await new Promise((r) => setTimeout(r, 12000));
    console.log("--- results ---");
    console.log("video packets:", packets, "| keyframes:", keyframes, "| config:", configs);
    console.log("bytes:", bytes, `(${(bytes / 1024 / 1024).toFixed(2)} MB)`);
    console.log("pts range:", firstPts, "->", lastPts);
    if (packets > 0) {
      console.log("avg packet:", Math.round(bytes / packets), "bytes");
      console.log("RESULT: VIDEO STREAMING OK");
    } else {
      console.log("RESULT: NO VIDEO PACKETS");
    }
    await session.disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error("CONNECT FAILED:", e.message);
    try {
      await session.disconnect();
    } catch {}
    process.exit(1);
  });