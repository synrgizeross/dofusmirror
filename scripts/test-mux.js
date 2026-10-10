const fs = require("fs");
const path = require("path");
const { MirrorSession } = require("../dist/main/session.js");
const { MP4Writer } = require("../src/renderer/mp4muxer.js");

const serial = process.argv[2];

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

function splitConfig(data) {
  const starts = startCodes(data);
  let sps = null;
  let pps = null;
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i];
    let end = i + 1 < starts.length ? starts[i + 1] - 3 : data.length;
    while (end > s && data[end - 1] === 0) end--;
    const type = data[s] & 0x1f;
    if (type === 7 && !sps) sps = data.slice(s, end);
    if (type === 8 && !pps) pps = data.slice(s, end);
  }
  return { sps, pps };
}

const options = {
  maxSize: 0,
  maxFps: 30,
  videoBitRate: 6000000,
  videoCodec: "h264",
  stayAwake: false,
  audio: false,
  newDisplay: null,
  autoLaunchPackage: null,
  clipboardAutosync: false,
};

const session = new MirrorSession(serial, options, path.join(__dirname, "..", "dist", "engine.jar"));
const writer = new MP4Writer({ width: 0, height: 0 });
let pending = [];
let packets = 0;

const flush = () => {
  if (!writer.isReady()) return;
  for (const p of pending) writer.addSample(p.data, p.pts, p.key);
  pending = [];
};

session.on("videoSize", (w, h) => {
  writer.width = w;
  writer.height = h;
  flush();
});
session.on("videoPacket", (p) => {
  packets++;
  if (p.isConfig) {
    const { sps, pps } = splitConfig(p.data);
    writer.setParameterSets(sps, pps);
    flush();
    return;
  }
  pending.push({ data: p.data, pts: p.pts, key: p.isKeyFrame });
  flush();
});

session
  .start()
  .then(async () => {
    await new Promise((r) => setTimeout(r, 8000));
    const ptsList = writer.samples.slice(0, 12).map((x) => x.pts);
    const deltas = writer.samples.slice(1, 12).map((x, i) => x.pts - writer.samples[i].pts);
    console.log("first pts:", ptsList.join(","));
    console.log("deltas:", deltas.join(","));
    console.log("writer.duration:", writer.duration, "samples:", writer.samples.length);
    const bytes = writer.finalize();
    console.log("packets received:", packets, "| samples:", writer.samples.length, "| sps/pps:", !!writer.sps, !!writer.pps);
    if (!bytes) {
      console.log("NO OUTPUT");
      process.exit(1);
    }
    fs.writeFileSync("/tmp/md-test.mp4", Buffer.from(bytes));
    console.log("wrote /tmp/md-test.mp4", bytes.length, "bytes");
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