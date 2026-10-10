const { MirrorSession } = require("../dist/main/session.js");
const { execFile } = require("child_process");

const adb = "./assets/platform-tools/darwin/adb";
const serial = process.argv[2];

function disp() {
  return new Promise((resolve) => {
    execFile(
      adb,
      ["-s", serial, "shell", "dumpsys display | grep -iE 'Display State=' | head -1"],
      { encoding: "utf8" },
      (e, out) => resolve(e ? "err" : out.trim())
    );
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let packets = 0;
let bytes = 0;

const session = new MirrorSession(
  serial,
  {
    maxSize: 0,
    maxFps: 30,
    videoBitRate: 4000000,
    videoCodec: "h264",
    stayAwake: true,
    audio: false,
    newDisplay: null,
    autoLaunchPackage: null,
    clipboardAutosync: false,
  },
  "dist/engine.jar"
);

session.on("log", (l) => {
  if (/display turned|error/i.test(l)) console.log("  [engine]", l);
});
session.on("videoPacket", (p) => {
  packets++;
  bytes += p.data.length;
});

(async () => {
  await session.start();
  console.log("connected:", session.deviceName);
  await wait(2500);
  console.log("1. initial      :", await disp(), `packets=${packets}`);

  packets = 0;
  session.controlChannel.injectKeyPress(26, 0);
  await wait(2500);
  console.log("2. after POWER  :", await disp(), `packets=${packets}`);

  await wait(4000);
  console.log("3. +4s streaming:", await disp(), `packets=${packets} bytes=${bytes}`);

  packets = 0;
  session.controlChannel.injectKeyPress(224, 0);
  await wait(3000);
  console.log("4. after WAKEUP :", await disp(), `packets=${packets}`);

  await session.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});