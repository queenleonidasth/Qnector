import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const appRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(appRoot, "src", "renderer"),
  build: {
    outDir: path.join(appRoot, "dist", "renderer"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.join(appRoot, "src", "renderer", "renderer.tsx"),
      output: {
        entryFileNames: "renderer.js",
        chunkFileNames: "chunks/[name].js",
        assetFileNames: "[name][extname]",
      },
    },
  },
});
