import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { Phase0Server } from "../packages/mcp-server/src/phase0.js";

const workspace = await mkdtemp(path.join(tmpdir(), "qnector-plus-"));
const testFile = path.join(workspace, "qnector-write-test.txt");
const port = await freePort();
const server = new Phase0Server({ testFile });
await server.start({ host: "127.0.0.1", port });
console.log(`Phase 0 MCP server is listening at http://127.0.0.1:${port}/mcp`);
console.log(
  "Expose this endpoint through an HTTPS tunnel, add it as a ChatGPT custom app in Developer Mode, and run ping/read_test/write_test.",
);
console.log(
  "This script only validates that the local Phase 0 server starts; Plus account capability must be recorded manually in docs/plus-compatibility.md.",
);
await server.stop();
await rm(workspace, { recursive: true, force: true });

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
