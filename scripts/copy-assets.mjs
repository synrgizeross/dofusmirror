import { cpSync, mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

// The renderer is bundled by Vite into dist/renderer (see src/renderer/vite.config.ts).
// It is deliberately NOT copied from source here - copying would overwrite the build.

const engine = join(root, "assets", "engine.jar");
if (existsSync(engine)) {
  cpSync(engine, join(dist, "engine.jar"));
}

console.log("assets copied");