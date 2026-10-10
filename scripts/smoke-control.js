const path = require("path");
const { MirrorSession } = require("../dist/main/session.js");
const { MotionEvent, KeyCode } = require("../dist/main/control.js");

const serial = process.argv[2];
if (!serial) {
  console.error("usage: node scripts/smoke-control.js <serial>");
  process.exit(1);
}

const options = {
  maxSize: 0,
  maxFps: 60,
  videoBitRate: 8_000_000,
  videoCodec: "h264",
  stayAwake: false,
  audio: false,
  newDisplay: null,
  autoLaunchPackage: null,
  clipboardAutosync: false,
};

const session = new MirrorSession(serial, options, path.join(__dirname, "..", "dist", "engine.jar"));

let packets = 0;
session.on("log", (l) => console.log("  [log]", l));
session.on("videoPacket", () => packets++);
session.on("videoSize", (w, h) => {
  console.log("  size:", `${w}x${h}`);
  const W = w;
  const H = h;
  const cx = Math.round(W / 2);
  const cy = Math.round(H / 2);
  const cc = session.controlChannel;

  setTimeout(() => {
    console.log("  inject touch down/move/up at", cx, cy);
    cc.injectTouch(MotionEvent.ActionDown, MotionEvent.PointerIdMouse, cx, cy, W, H, 1, MotionEvent.ButtonPrimary, MotionEvent.ButtonPrimary);
    for (let i = 0; i < 5; i++) {
      cc.injectTouch(MotionEvent.ActionMove, MotionEvent.PointerIdMouse, cx + i * 4, cy, W, H, 1, 0, MotionEvent.ButtonPrimary);
    }
    cc.injectTouch(MotionEvent.ActionUp, MotionEvent.PointerIdMouse, cx, cy, W, H, 0, MotionEvent.ButtonPrimary, 0);

    cc.injectScroll(cx, cy, W, H, 0, -2, 0);
    cc.injectKeyPress(KeyCode.Back);
    cc.injectText("hello");
    cc.setClipboard("mirrordeck", false);
    cc.sendSimple(0x33);
    console.log("  control messages sent");
  }, 1500);
});

session
  .start()
  .then(async (hello) => {
    console.log("HELLO OK:", hello.deviceName);
    await new Promise((r) => setTimeout(r, 9000));
    console.log("--- results ---");
    console.log("video packets while injecting:", packets);
    let alive = true;
    session.once("disconnected", () => (alive = false));
    console.log(alive ? "RESULT: SESSION STILL ALIVE AFTER INPUT (CONTROL OK)" : "RESULT: SESSION DROPPED");
    await session.disconnect();
    process.exit(alive ? 0 : 1);
  })
  .catch(async (e) => {
    console.error("CONNECT FAILED:", e.message);
    try {
      await session.disconnect();
    } catch {}
    process.exit(1);
  });