// Kept as a discoverable entry point for tooling; run the TypeScript implementation through tsx.
import { spawn } from "node:child_process";

const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["tsx", "scripts/smoke-mcp.ts"],
  { stdio: "inherit", shell: false },
);
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
