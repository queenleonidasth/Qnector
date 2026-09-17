import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { secureExecutionRoot } from "./private-root.js";

const windowsIt = process.platform === "win32" ? it : it.skip;
describe("durable journal ACL startup gate", () => {
  windowsIt("protects an existing token and rejects an explicit Everyone ACL", () => {
    const root = mkdtempSync(path.join(tmpdir(), "qnector-private-root-"));
    const token = path.join(root, "daemon-token");
    try {
      writeFileSync(token, "fixture");
      secureExecutionRoot(root);
      const good = spawnSync("icacls.exe", [root], {encoding: "utf8", windowsHide: true});
      expect(good.status).toBe(0);
      expect(good.stdout).not.toMatch(/Everyone|Authenticated Users|BUILTIN\\Users/);
      const grant = spawnSync("icacls.exe", [token, "/grant", "*S-1-1-0:R"],
        {encoding: "utf8", windowsHide: true});
      expect(grant.status).toBe(0);
      expect(() => secureExecutionRoot(root)).toThrow("DAEMON_ACL_AUDIT_FAILED");
    } finally {
      rmSync(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
    }
  }, 20_000);
});
