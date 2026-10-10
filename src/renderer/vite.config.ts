import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  // relative asset URLs: the renderer is loaded over file://
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(root, "src") },
  },
  build: {
    outDir: path.resolve(root, "../../dist/renderer"),
    emptyOutDir: true,
    target: "chrome130",
  },
  server: { port: 5178, strictPort: true },
});