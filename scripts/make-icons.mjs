// Renders build/icon.svg to build/icon.png (1024x1024 master) using headless Chrome.
// electron-builder derives .icns (macOS), .ico (Windows) and PNG sets (Linux) from it.
// Usage: npm run icons

import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);

const chrome = CHROME_CANDIDATES.find((p) => {
  try {
    return existsSync(p) || p === "google-chrome";
  } catch {
    return false;
  }
});

if (!chrome) {
  console.error("Chrome/Chromium not found. Set CHROME_BIN to your browser binary.");
  process.exit(1);
}

const root = resolve(import.meta.dirname, "..");
const svg = resolve(root, "build/icon.svg");
const out = resolve(root, "build/icon.png");
const tmp = resolve(root, "build/.icon-render");

mkdirSync(tmp, { recursive: true });
writeFileSync(
  resolve(tmp, "index.html"),
  `<!doctype html><html><head><style>html,body{margin:0;padding:0;background:transparent}</style></head><body>${readFileSync(svg, "utf8")}</body></html>`
);

execFileSync(
  chrome,
  [
    "--headless",
    "--disable-gpu",
    "--hide-scrollbars",
    "--default-background-color=00000000",
    "--window-size=1024,1024",
    `--screenshot=${out}`,
    `file://${resolve(tmp, "index.html")}`,
  ],
  { stdio: "inherit" }
);

rmSync(tmp, { recursive: true, force: true });
console.log("icon written:", out);