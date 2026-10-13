// Ensures assets/platform-tools/<platform> exists before a build or package.
// assets/platform-tools is gitignored, so a fresh clone has no bundled adb and
// the packaged app would ship without it. Downloads it once if missing.
//
// Runs automatically via the prebuild / prepack / predist npm hooks.

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { platform } from "node:process";

const DIR = {
  darwin: "darwin",
  win32: "windows",
  linux: "linux",
}[platform];

const root = resolve(import.meta.dirname, "..");
const target = resolve(root, "assets/platform-tools", DIR ?? "");

if (!DIR) {
  console.warn(`ensure-platform-tools: unsupported platform "${platform}", skipping`);
  process.exit(0);
}

if (existsSync(target)) {
  console.log(`ensure-platform-tools: ${DIR} already present`);
  process.exit(0);
}

console.log(`ensure-platform-tools: fetching ${DIR} platform-tools...`);
const r = spawnSync(process.execPath, [resolve(root, "scripts/fetch-platform-tools.mjs")], {
  stdio: "inherit",
});

if (r.status !== 0 || !existsSync(target)) {
  console.error(
    "ensure-platform-tools: download failed. Run `npm run fetch:platform-tools` manually."
  );
  process.exit(r.status ?? 1);
}

console.log(`ensure-platform-tools: ready (${DIR})`);