import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ResultEvidenceStore } from "./result-evidence-store.js";

describe("ResultEvidenceStore", () => {
  let root: string | undefined;
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = undefined; });

  it("persists exact large evidence, pages by cursor, and verifies its full hash", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "qnector-evidence-"));
    const owner = { workspaceId: "workspace-a", taskId: "task-a" };
    const store = new ResultEvidenceStore(root, 2_000_000, 3_000_000);
    const raw = `${"line-data-".repeat(20_000)}終`; // larger than one compact response
    const ref = await store.put(owner, raw);
    const idempotent = await store.put(owner, raw, "job-a:0:200000");
    const retry = await store.put(owner, raw, "job-a:0:200000");
    expect(retry.id).toBe(idempotent.id);
    const rehydrated = new ResultEvidenceStore(root, 2_000_000, 3_000_000);
    const first = await rehydrated.read(owner, ref.id, null, 2_000);
    expect(first.complete).toBe(false);
    const second = await rehydrated.read(owner, ref.id, first.nextCursor, 2_000);
    expect(second.id).toBe(ref.id);
    let cursor = second.nextCursor;
    const chunks = [Buffer.from(first.dataBase64, "base64"), Buffer.from(second.dataBase64, "base64")];
    while (cursor) {
      const page = await rehydrated.read(owner, ref.id, cursor, 2_000);
      chunks.push(Buffer.from(page.dataBase64, "base64"));
      cursor = page.nextCursor;
    }
    expect(Buffer.concat(chunks).toString("utf8")).toBe(raw);
  });

  it("rejects cross-task hydration, invalid cursors, and over-budget data without truncation", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "qnector-evidence-limit-"));
    const store = new ResultEvidenceStore(root, 32, 48);
    const owner = { workspaceId: "workspace-a", taskId: "task-a" };
    await expect(store.put(owner, "x".repeat(33))).rejects.toThrow("ENTRY_LIMIT");
    const ref = await store.put(owner, "complete evidence");
    await expect(store.read({ ...owner, taskId: "task-b" }, ref.id, null, 100)).rejects.toThrow();
    await expect(store.read(owner, ref.id, "malformed", 100)).rejects.toThrow("CURSOR_INVALID");
  });
});
