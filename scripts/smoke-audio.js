const path = require("path");
const { MirrorSession } = require("../dist/main/session.js");

const serial = process.argv[2];
const options = {
  maxSize: 0,
  maxFps: 60,
  videoBitRate: 8000000,
  videoCodec: "h264",
  stayAwake: false,
  audio: true,
  newDisplay: null,
  autoLaunchPackage: null,
  clipboardAutosync: false,
};

const session = new MirrorSession(serial, options, process.argv[3] || path.join(__dirname, "..", "dist", "engine.jar"));
let video = 0;
let audio = 0;
let audioBytes = 0;
let audioEnded = null;

session.on("log", (l) => console.log("  [log]", l));
session.on("videoPacket", () => video++);
session.on("audioPacket", (p) => {
  audio++;
  audioBytes += p.data.length;
});
session.on("audioMeta", (m) => console.log("  audio codec meta:", m.codec));
session.on("audioEnded", (isErr) => {
  audioEnded = isErr;
  console.log("  audio stream ended, isError=", isErr);
});

session
  .start()
  .then(async (hello) => {
    console.log("HELLO OK:", hello.deviceName);
    await new Promise((r) => setTimeout(r, 10000));
    console.log("--- results ---");
    console.log("video packets:", video);
    console.log("audio packets:", audio, "bytes:", audioBytes);
    console.log("audioEnded:", audioEnded);
    await session.disconnect();
    process.exit(audio > 0 ? 0 : 2);
  })
  .catch(async (e) => {
    console.error("CONNECT FAILED:", e.message);
    try {
      await session.disconnect();
    } catch {}
    process.exit(1);
  });