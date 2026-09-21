import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProcessManager } from "@qnector/core";
import type { ProcessSnapshot } from "@qnector/shared";
import { DurableDaemon } from "../../../apps/daemon/src/server.js";
import { ExecutionFacade } from "./execution-facade.js";
import { executeDurableTask } from "./durable-task-tool.js";

const roots: string[] = [];
const daemons: DurableDaemon[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const daemon of daemons.splice(0)) await daemon.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function snapshot(id: string, cwd: string): ProcessSnapshot {
  return {
    id,
    command: "private long running command",
    cwd,
    startedAt: new Date().toISOString(),
    state: "running",
    cursor: 0,
    outputSize: 0,
  };
}

describe("explicit session and daemon execution facade", () => {
  it("shows only the active workspace, labels owners, limits each source and keeps session work out of daemon", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "qnector-unified-tasks-"));
    roots.push(root);
    const workspace = path.join(root, "workspace");
    const foreign = path.join(root, "foreign");
    mkdirSync(workspace);
    mkdirSync(foreign);
    const daemonRoot = path.join(root, "daemon");
    const daemon = new DurableDaemon(daemonRoot);
    daemons.push(daemon);
    await daemon.start();
    const manager = new ProcessManager("direct");
    const visible = snapshot("proc_visible", path.join(workspace, "subfolder"));
    const hidden = snapshot("proc_hidden", foreign);
    vi.spyOn(manager, "list").mockReturnValue([visible, hidden]);
    vi.spyOn(manager, "snapshot").mockImplementation((id) => {
      if (id === visible.id) return visible;
      if (id === hidden.id) return hidden;
      throw new Error("PROCESS_NOT_FOUND");
    });
    const facade = new ExecutionFacade(daemonRoot, manager);
    const overview = await facade.execute(workspace, {
      action: "overview",
      limit: 1,
    });
    expect(overview).toMatchObject({
      ok: true,
      data: {
        durableCount: 0,
        sessionCount: 1,
        tasks: [
          { taskId: "proc_visible", kind: "session", taskLifetime: "session" },
        ],
      },
    });
    expect(JSON.stringify(overview)).not.toContain("proc_hidden");
    expect(
      (
        await facade.execute(workspace, {
          action: "lookup",
          taskId: visible.id,
        })
      ).data,
    ).toMatchObject({
      kind: "session",
      taskLifetime: "session",
      taskProtocol: "qnector-process-v1",
      taskId: visible.id,
    });
    expect(
      await facade.execute(workspace, { action: "lookup", taskId: hidden.id }),
    ).toMatchObject({ ok: false, error: { code: "TASK_NOT_FOUND" } });
    expect(
      await facade.execute(workspace, {
        action: "lookup",
        taskId: "proc_missing",
      }),
    ).toMatchObject({ ok: false, error: { code: "TASK_NOT_FOUND" } });
    expect(
      await facade.execute(workspace, { action: "overview", limit: 0 }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(
      await facade.execute(workspace, {
        action: "lookup",
        taskId: "bad_identifier",
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });

    const durable = await executeDurableTask(daemonRoot, workspace, {
      action: "start",
      idempotencyKey: "one-durable-job",
      command: {
        kind: "direct",
        file: process.execPath,
        args: ["-e", "console.log('done')"],
      },
    });
    expect(durable.ok).toBe(true);
    const durableId = (durable.data as { taskId: string }).taskId;
    const unified = await facade.execute(workspace, {
      action: "overview",
      limit: 2,
    });
    expect(unified).toMatchObject({
      ok: true,
      data: { durableCount: 1, sessionCount: 1 },
    });
    expect(JSON.stringify(unified)).toContain(durableId);
    expect(
      (await facade.execute(workspace, { action: "lookup", taskId: durableId }))
        .data,
    ).toMatchObject({
      taskId: durableId,
      kind: "durable",
      taskLifetime: "persistent",
    });
    expect(
      await facade.execute(foreign, { action: "lookup", taskId: durableId }),
    ).toMatchObject({ ok: false, error: { code: "TASK_NOT_FOUND" } });
  }, 20_000);
});
