import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    // Content JSON lives at the repo root.
    fs: { allow: [repoRoot] },
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 2500,
  },
});
