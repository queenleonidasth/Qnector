import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DurableDaemon } from "../../../daemon/src/server.js";
import { daemonRequest } from "../../../daemon/src/client.js";
import { cancelDurableJob, listDurableJobs, readDurableJobOutput } from "./durable-jobs.js";

describe("Desktop durable jobs workspace and owner boundaries", () => {
  it("does not show, read or cancel a different workspace's jobs", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "qnector-desktop-jobs-"));
    const daemonRoot = path.join(root, "daemon");
    const workspace = path.join(root, "workspace-a");
    const foreign = path.join(root, "workspace-b");
    const marker = path.join(root, "once.txt");
    mkdirSync(workspace);
    const daemon = new DurableDaemon(daemonRoot);
    try {
      expect(await listDurableJobs(undefined, workspace)).toMatchObject({enabled: false, state: "disabled"});
      await daemon.start();
      const command = {kind: "direct", file: process.execPath, args: ["-e",
        "setTimeout(()=>{require('fs').appendFileSync(process.argv[1],'ONE\\n');console.log('FINISHED')},700)", marker]};
      const accepted = await daemonRequest(daemonRoot, {action: "submit", workspace,
        idempotencyKey: "single-workspace", command, timeoutMs: 8_000});
      expect(accepted.ok).toBe(true);
      const taskId = (accepted.data as {taskId: string}).taskId;
      const allowed = await listDurableJobs(daemonRoot, workspace);
      expect(allowed.jobs.map(job => job.taskId)).toContain(taskId);
      expect((await listDurableJobs(daemonRoot, foreign)).jobs).toHaveLength(0);
      await expect(cancelDurableJob(daemonRoot, foreign, taskId)).rejects.toThrow("TASK_NOT_FOUND");
      await expect(readDurableJobOutput(daemonRoot, foreign, taskId, "stdout")).rejects.toThrow("TASK_NOT_FOUND");
      const waited = await daemonRequest(daemonRoot, {action: "wait", taskId, waitTimeoutMs: 8_000}, 10_000);
      expect(waited.data).toMatchObject({state: "succeeded"});
      expect(await readDurableJobOutput(daemonRoot, workspace, taskId, "stdout"))
        .toMatchObject({text: "FINISHED\n", complete: true});
      expect(readFileSync(marker, "utf8")).toBe("ONE\n");
    } finally {
      await daemon.close();
      rmSync(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
    }
  }, 20_000);
});
