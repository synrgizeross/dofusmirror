const path = require("path");
const { MirrorSession } = require("../dist/main/session.js");

const serial = process.argv[2];
const options = {
  maxSize: 0,
  maxFps: 30,
  videoBitRate: 4000000,
  videoCodec: "h264",
  stayAwake: false,
  audio: true,
  newDisplay: null,
  autoLaunchPackage: null,
  clipboardAutosync: false,
};

const session = new MirrorSession(serial, options, path.join(__dirname, "..", "dist", "engine.jar"));
let n = 0;
session.on("audioPacket", (p) => {
  n++;
  if (n <= 5) {
    console.log(`audio#${n} len=${p.data.length} config=${p.isConfig} key=${p.isKeyFrame} pts=${p.pts}`);
    console.log("  head:", Array.from(p.data.slice(0, 10)).map((b) => b.toString(16).padStart(2, "0")).join(" "));
  }
});

session
  .start()
  .then(async () => {
    await new Promise((r) => setTimeout(r, 6000));
    console.log("total audio packets:", n);
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