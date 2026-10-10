const path = require("path");
const { MirrorSession } = require("../dist/main/session.js");

const serial = process.argv[2];
const options = {
  maxSize: 0,
  maxFps: 30,
  videoBitRate: 4000000,
  videoCodec: "h265",
  stayAwake: false,
  audio: false,
  newDisplay: null,
  autoLaunchPackage: null,
  clipboardAutosync: false,
};

const session = new MirrorSession(serial, options, path.join(__dirname, "..", "dist", "engine.jar"));
let printed = 0;

function startCodes(data) {
  const starts = [];
  for (let i = 0; i + 2 < data.length; i++) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
      starts.push(i + 3);
      i += 2;
    }
  }
  return starts;
}

session.on("videoMeta", (m) => console.log("codec meta:", m.codec));
session.on("videoPacket", (p) => {
  if (printed >= 3) return;
  printed++;
  const starts = startCodes(p.data);
  const kinds = starts.map((s) => `type${s < p.data.length ? (p.data[s] >> 1) & 0x3f : "?"}@${s}`);
  console.log(`pkt${printed} len=${p.data.length} config=${p.isConfig} key=${p.isKeyFrame} starts=[${starts.join(",")}] ${kinds.join(" ")}`);
  console.log("  head:", Array.from(p.data.slice(0, 24)).map((b) => b.toString(16).padStart(2, "0")).join(" "));
  if (p.isConfig) require("fs").writeFileSync("/tmp/md-h265-config.bin", p.data);
});

session
  .start()
  .then(async () => {
    await new Promise((r) => setTimeout(r, 6000));
    await session.disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error("FAILED:", e.message);
    try {
      await session.disconnect();
    } catch {}
    process.exit(1);
  });