import { createWriteStream } from "fs";
import { mkdir, rm, rename } from "fs/promises";
import { execFileSync } from "child_process";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "assets", "platform-tools");

const targets = [
  { dir: "darwin", file: "platform-tools-latest-darwin.zip" },
  { dir: "linux", file: "platform-tools-latest-linux.zip" },
  { dir: "windows", file: "platform-tools-latest-windows.zip" },
];

const tmp = path.join(outDir, ".tmp");

async function fetchZip(name) {
  const url = `https://dl.google.com/android/repository/${name}`;
  const dest = path.join(tmp, name);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`${url} -> ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  return dest;
}

await mkdir(tmp, { recursive: true });

for (const t of targets) {
  process.stdout.write(`downloading ${t.file} ... `);
  try {
    const zip = await fetchZip(t.file);
    const stage = path.join(tmp, `stage-${t.dir}`);
    await rm(stage, { recursive: true, force: true });
    mkdir(stage, { recursive: true });
    execFileSync("unzip", ["-q", "-o", zip, "-d", stage]);
    const inner = path.join(stage, "platform-tools");
    const dest = path.join(outDir, t.dir);
    await rm(dest, { recursive: true, force: true });
    await rename(inner, dest);
    console.log("ok");
  } catch (e) {
    console.log(`failed: ${e.message}`);
  }
}

await rm(tmp, { recursive: true, force: true });
console.log("platform-tools ready");