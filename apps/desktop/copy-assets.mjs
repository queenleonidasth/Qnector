import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
await mkdir(path.join(appRoot, "dist", "renderer"), { recursive: true });
await copyFile(
  path.join(appRoot, "src", "renderer", "styles.css"),
  path.join(appRoot, "dist", "renderer", "styles.css"),
);
