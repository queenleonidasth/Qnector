import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getVersion: () => "0.4.5",
    getPath: () => os.tmpdir(),
    isPackaged: true,
    quit: vi.fn(),
  },
}));

import { DesktopUpdater } from "./updater.js";

const cleanup: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const target of cleanup.splice(0)) {
    await rm(target, { recursive: true, force: true });
  }
});

describe.skipIf(process.platform !== "win32")(
  "DesktopUpdater end-to-end download",
  () => {
    it("checks, resumes, verifies SHA-256 and promotes a partial portable update", async () => {
      const userData = await mkdtemp(
        path.join(os.tmpdir(), "qnector-updater-e2e-"),
      );
      cleanup.push(userData);
      const assetName = "Qnector-0.4.6-win-x64-portable.exe";
      const asset = Buffer.from(
        "Qnector updater integration payload\n".repeat(4096),
        "utf8",
      );
      const digest = createHash("sha256").update(asset).digest("hex");
      let observedRange = "";
      let baseUrl = "";

      const server = createServer((request, response) => {
        if (request.url === "/release") {
          response.setHeader("content-type", "application/json");
          response.end(
            JSON.stringify({
              tag_name: "v0.4.6",
              name: "Qnector v0.4.6",
              html_url: `${baseUrl}/release-page`,
              published_at: new Date().toISOString(),
              body: "integration release",
              assets: [
                {
                  name: assetName,
                  browser_download_url: `${baseUrl}/asset`,
                  size: asset.length,
                  digest: `sha256:${digest}`,
                },
              ],
            }),
          );
          return;
        }
        if (request.url === "/asset") {
          observedRange = String(request.headers.range ?? "");
          const match = /^bytes=(\d+)-$/.exec(observedRange);
          const start = match ? Number(match[1]) : 0;
          if (start > 0) {
            response.statusCode = 206;
            response.setHeader(
              "content-range",
              `bytes ${start}-${asset.length - 1}/${asset.length}`,
            );
          }
          response.setHeader("content-length", String(asset.length - start));
          response.end(asset.subarray(start));
          return;
        }
        response.statusCode = 404;
        response.end();
      });
      servers.push(server);
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("test server missing port");
      baseUrl = `http://127.0.0.1:${address.port}`;

      const updateDir = path.join(userData, "updates", "0.4.6");
      const destination = path.join(updateDir, assetName);
      const partial = `${destination}.part`;
      const partialSize = 8192;
      await mkdir(updateDir, { recursive: true });
      await writeFile(partial, asset.subarray(0, partialSize));

      const states: string[] = [];
      const updater = new DesktopUpdater((state) => states.push(state.phase), {
        releaseApi: `${baseUrl}/release`,
        releasesUrl: `${baseUrl}/releases`,
        currentVersion: "0.4.5",
        mode: "portable",
        userDataPath: userData,
      });

      const checked = await updater.check();
      expect(checked.phase).toBe("available");
      expect(checked.latestVersion).toBe("0.4.6");
      expect(checked.canDownload).toBe(true);

      const downloaded = await updater.download();
      expect(downloaded.phase).toBe("downloaded");
      expect(downloaded.progress).toBe(1);
      expect(downloaded.canInstall).toBe(true);
      expect(downloaded.message).toContain("resumed and SHA-256 verified");
      expect(observedRange).toBe(`bytes=${partialSize}-`);
      expect(await readFile(destination)).toEqual(asset);
      await expect(readFile(partial)).rejects.toThrow();
      expect(states).toContain("checking");
      expect(states).toContain("downloading");
      expect(states.at(-1)).toBe("downloaded");
    });
  },
);
