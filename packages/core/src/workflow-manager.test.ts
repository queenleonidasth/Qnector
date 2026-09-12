import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileWatchService } from "./file-watch.js";
import { ProcessManager } from "./process-manager.js";
import {
  WorkflowManager,
  type WorkflowRun,
  type WorkflowToolExecutor,
} from "./workflow-manager.js";

const roots: string[] = [];

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function createManager(executeTool?: WorkflowToolExecutor): WorkflowManager {
  return new WorkflowManager(
    new ProcessManager("direct"),
    new FileWatchService(),
    {
      ...(executeTool ? { executeTool } : {}),
    },
  );
}

afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("WorkflowManager harness", () => {
  it("kills an active command before reporting the run canceled", async () => {
    const root = await temporaryRoot("qnector-workflow-cancel-");
    const manager = createManager();
    const script =
      "setTimeout(()=>require('node:fs').writeFileSync('late.txt','late'),1200);setTimeout(()=>{},5000)";
    const run = await manager.run(root, {
      name: "cancel-delayed-write",
      mode: "graph",
      maxConcurrency: 2,
      steps: [
        {
          id: "delayed-write",
          type: "command",
          shell: "direct",
          command: `node -e \"${script}\"`,
          resourcePaths: ["late.txt"],
          outputs: ["late.txt"],
        },
      ],
    });

    await new Promise((resolve) => setTimeout(resolve, 150));
    const canceled = await manager.cancel(root, run.runId);
    expect(canceled.state).toBe("canceled");
    expect(canceled.steps[0]?.state).toBe("canceled");

    await new Promise((resolve) => setTimeout(resolve, 1_350));
    expect(existsSync(path.join(root, "late.txt"))).toBe(false);
  }, 10_000);

  it("runs independent graph steps concurrently and waits for dependencies", async () => {
    const root = await temporaryRoot("qnector-workflow-graph-");
    const manager = createManager();
    const started = Date.now();
    const run = await manager.run(root, {
      name: "parallel-delays",
      mode: "graph",
      maxConcurrency: 4,
      steps: [
        { id: "a", type: "delay", delayMs: 220 },
        { id: "b", type: "delay", delayMs: 220 },
        { id: "c", type: "delay", delayMs: 220 },
        { id: "d", type: "delay", delayMs: 220 },
        {
          id: "collect",
          type: "delay",
          delayMs: 0,
          dependsOn: ["a", "b", "c", "d"],
        },
      ],
    });
    const finished = await manager.wait(root, run.runId, 5_000);
    const elapsed = Date.now() - started;

    expect(finished.timedOut).toBe(false);
    expect(finished.run.state).toBe("succeeded");
    expect(finished.run.steps.every((step) => step.state === "succeeded")).toBe(
      true,
    );
    expect(
      new Date(finished.run.steps[4]!.startedAt!).getTime(),
    ).toBeGreaterThanOrEqual(
      Math.max(
        ...finished.run.steps
          .slice(0, 4)
          .map((step) => new Date(step.endedAt!).getTime()),
      ),
    );
    expect(elapsed).toBeLessThan(700);
  });

  it("serializes overlapping resources while allowing independent resources", async () => {
    const root = await temporaryRoot("qnector-workflow-resources-");
    let active = 0;
    let peak = 0;
    const starts: string[] = [];
    const manager = createManager(async (_tool, input) => {
      const id = String(input.id);
      starts.push(id);
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 120));
      active -= 1;
      return { ok: true, summary: `finished ${id}` };
    });

    const run = await manager.run(root, {
      name: "resource-coordination",
      mode: "graph",
      maxConcurrency: 3,
      steps: [
        {
          id: "same-a",
          type: "tool",
          tool: "test",
          input: { id: "same-a" },
          resourcePaths: ["out/shared.txt"],
          replay: "safe",
        },
        {
          id: "same-b",
          type: "tool",
          tool: "test",
          input: { id: "same-b" },
          resourcePaths: ["out/shared.txt"],
          replay: "safe",
        },
        {
          id: "other",
          type: "tool",
          tool: "test",
          input: { id: "other" },
          resourcePaths: ["out/other.txt"],
          replay: "safe",
        },
      ],
    });
    const finished = await manager.wait(root, run.runId, 5_000);

    expect(finished.run.state).toBe("succeeded");
    expect(peak).toBe(2);
    expect(starts.slice(0, 2)).toContain("other");
    const sameA = finished.run.steps.find((step) => step.id === "same-a")!;
    const sameB = finished.run.steps.find((step) => step.id === "same-b")!;
    const aStart = new Date(sameA.startedAt!).getTime();
    const aEnd = new Date(sameA.endedAt!).getTime();
    const bStart = new Date(sameB.startedAt!).getTime();
    const bEnd = new Date(sameB.endedAt!).getTime();
    expect(aEnd <= bStart || bEnd <= aStart).toBe(true);
  });

  it("keeps independent work, skips failed dependencies, and stores full results", async () => {
    const root = await temporaryRoot("qnector-workflow-partial-");
    const manager = createManager(async (_tool, input) => {
      if (input.fail)
        return {
          ok: false,
          summary: "fixture failed",
          error: { code: "FIXTURE_FAIL", message: "boom" },
        };
      return { ok: true, summary: "fixture passed", data: { value: "kept" } };
    });
    const run = await manager.run(root, {
      name: "partial-outcomes",
      mode: "graph",
      maxConcurrency: 3,
      steps: [
        {
          id: "bad",
          type: "tool",
          tool: "fixture",
          input: { fail: true },
          replay: "safe",
        },
        {
          id: "independent",
          type: "tool",
          tool: "fixture",
          input: { fail: false },
          replay: "safe",
        },
        {
          id: "blocked",
          type: "delay",
          delayMs: 0,
          dependsOn: ["bad"],
        },
      ],
    });
    const finished = await manager.wait(root, run.runId, 5_000);

    expect(finished.run.state).toBe("failed");
    expect(finished.run.steps.find((step) => step.id === "bad")?.state).toBe(
      "failed",
    );
    expect(
      finished.run.steps.find((step) => step.id === "independent")?.state,
    ).toBe("succeeded");
    expect(
      finished.run.steps.find((step) => step.id === "blocked")?.state,
    ).toBe("skipped");

    const full = await manager.result(root, run.runId, "independent");
    expect(JSON.stringify(full)).toContain("kept");
    const index = await manager.result(root, run.runId);
    expect(JSON.stringify(index)).toContain("workflow-results");
  });

  it("marks orphaned running executions interrupted and requires replay confirmation for mutations", async () => {
    const root = await temporaryRoot("qnector-workflow-recovery-");
    const manager = createManager();
    const definition = await manager.save(root, {
      name: "recovery",
      mode: "graph",
      maxConcurrency: 1,
      steps: [
        {
          id: "mutation",
          type: "command",
          shell: "direct",
          command: 'node -e "process.exit(0)"',
        },
      ],
    });
    const runId = "workflow_11111111-1111-4111-8111-111111111111";
    const now = new Date().toISOString();
    const persisted: WorkflowRun = {
      runId,
      workflow: definition.name,
      workspace: root,
      state: "running",
      mode: "graph",
      maxConcurrency: 1,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      currentStep: 0,
      activeSteps: ["mutation"],
      definition,
      steps: [
        {
          index: 0,
          id: "mutation",
          type: "command",
          state: "running",
          dependsOn: [],
          resourcePaths: [],
          outputs: [],
          attempt: 1,
          startedAt: now,
        },
      ],
    };
    const runFile = path.join(
      root,
      ".qnector",
      "workflow-runs",
      `${runId}.json`,
    );
    await mkdir(path.dirname(runFile), { recursive: true });
    await writeFile(runFile, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");

    const recoveredManager = createManager();
    const recovered = await recoveredManager.status(root, runId);
    expect(recovered.state).toBe("interrupted");
    expect(recovered.steps[0]?.state).toBe("interrupted");
    await expect(recoveredManager.resume(root, runId)).rejects.toThrow(
      "WORKFLOW_REPLAY_CONFIRMATION_REQUIRED",
    );

    const resumed = await recoveredManager.resume(root, runId, {
      replayInterrupted: true,
    });
    expect(["pending", "running", "succeeded"]).toContain(resumed.state);
    const finished = await recoveredManager.wait(root, runId, 5_000);
    expect(finished.run.state).toBe("succeeded");
    const stored = JSON.parse(await readFile(runFile, "utf8")) as WorkflowRun;
    expect(stored.steps[0]?.attempt).toBe(2);
  });

  it("rejects missing dependencies and dependency cycles before a run starts", async () => {
    const root = await temporaryRoot("qnector-workflow-validation-");
    const manager = createManager();
    await expect(
      manager.run(root, {
        name: "missing",
        mode: "graph",
        steps: [{ id: "a", type: "delay", delayMs: 0, dependsOn: ["missing"] }],
      }),
    ).rejects.toThrow("depends on missing step");
    await expect(
      manager.run(root, {
        name: "cycle",
        mode: "graph",
        steps: [
          { id: "a", type: "delay", delayMs: 0, dependsOn: ["b"] },
          { id: "b", type: "delay", delayMs: 0, dependsOn: ["a"] },
        ],
      }),
    ).rejects.toThrow("dependency cycle");
  });
});
