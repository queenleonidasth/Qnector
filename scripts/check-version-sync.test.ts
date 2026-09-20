import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkVersionSync } from "./check-version-sync.mjs";

const temporaryRoots = [];
function fixture(
  rootVersion = "0.4.42",
  desktopVersion = "0.4.42",
  mcpVersion = "0.4.42",
) {
  const root = mkdtempSync(path.join(os.tmpdir(), "qnector-version-test-"));
  temporaryRoots.push(root);
  mkdirSync(path.join(root, "apps/desktop"), { recursive: true });
  mkdirSync(path.join(root, "packages/core/src"), { recursive: true });
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ version: rootVersion }),
  );
  writeFileSync(
    path.join(root, "apps/desktop/package.json"),
    JSON.stringify({ version: desktopVersion }),
  );
  writeFileSync(
    path.join(root, "packages/core/src/config.ts"),
    `export const QNECTOR_VERSION = "${mcpVersion}";\n`,
  );
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("version synchronization gate", () => {
  it("accepts matching root, desktop and MCP versions", () => {
    expect(checkVersionSync(fixture())).toBe("0.4.42");
  });
  it("rejects a stale MCP version", () => {
    expect(() =>
      checkVersionSync(fixture("0.4.42", "0.4.42", "0.4.38")),
    ).toThrow(/root=0\.4\.42, desktop=0\.4\.42, MCP=0\.4\.38/);
  });
  it("rejects a desktop package mismatch", () => {
    expect(() => checkVersionSync(fixture("0.4.42", "0.4.41"))).toThrow(
      /version mismatch/,
    );
  });
});
