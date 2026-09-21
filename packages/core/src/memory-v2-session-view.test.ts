import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryV2Store } from "./memory-v2-store.js";

describe("Memory Center last saved session", () => {
  it("shows the newest explicitly bound session topic and isolates workspaces", () => {
    const root = mkdtempSync(path.join(tmpdir(), "qnector-session-view-"));
    const store = new MemoryV2Store(path.join(root, "first"), {
      file: path.join(root, "memory.sqlite"),
    });
    try {
      expect(store.snapshot().lastSession).toBeNull();
      const first = store.createTask({ title: "First saved discussion" });
      const second = store.createTask({ title: "Second saved discussion" });
      store.bindSession("conversation-1", first.id);
      expect(store.snapshot().lastSession).toMatchObject({
        taskId: first.id,
        title: "First saved discussion",
        linkedAt: expect.any(String),
      });
      store.bindSession("conversation-2", second.id);
      expect(store.snapshot().lastSession?.title).toBe("Second saved discussion");
      store.setWorkspace(path.join(root, "second"));
      expect(store.snapshot().lastSession).toBeNull();
      store.setWorkspace(path.join(root, "first"));
      expect(store.snapshot().lastSession?.taskId).toBe(second.id);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
