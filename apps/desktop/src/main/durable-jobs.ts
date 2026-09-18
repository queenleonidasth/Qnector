import path from "node:path";
import { daemonRequest } from "@qnector/daemon/client";

export interface DurableJobRow {
  taskId: string;
  state: string;
  outcome: string;
  attemptId: string | null;
  createdAt: string;
}
export interface DurableJobsSnapshot {
  enabled: boolean;
  state: "disabled" | "ready" | "unavailable";
  health?: {
    state: "ready" | "degraded";
    protocol: number;
    jobHostEnabled: boolean;
    storage: unknown;
    note?: string;
  };
  jobs: DurableJobRow[];
  message?: string;
}

function sameWorkspace(left: string, right: string): boolean {
  const canonical = (value: string) => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return canonical(left) === canonical(right);
}

/** Local Desktop only: never accepts a daemon root or workspace from renderer IPC. */
export async function listDurableJobs(
  root: string | undefined,
  workspace: string,
): Promise<DurableJobsSnapshot> {
  if (!root) return { enabled: false, state: "disabled", jobs: [] };
  try {
    // Both requests are passive: neither starts, cancels nor retries any job.
    const [response, doctor] = await Promise.all([
      daemonRequest(root, { action: "list", workspace, limit: 50 }, 3_000),
      daemonRequest(root, { action: "doctor" }, 3_000),
    ]);
    if (!response.ok || !Array.isArray(response.data))
      throw new Error(response.error ?? "DAEMON_LIST_INVALID");
    if (!doctor.ok || !doctor.data)
      throw new Error(doctor.error ?? "DAEMON_DOCTOR_INVALID");
    const health = doctor.data as NonNullable<DurableJobsSnapshot["health"]>;
    return {
      enabled: true,
      state: "ready",
      health,
      jobs: response.data as DurableJobRow[],
    };
  } catch (error) {
    return {
      enabled: true,
      state: "unavailable",
      jobs: [],
      message: error instanceof Error ? error.message : "DAEMON_UNAVAILABLE",
    };
  }
}

async function verifiedTask(
  root: string | undefined,
  workspace: string,
  taskId: string,
): Promise<string> {
  if (!root) throw new Error("DURABLE_PREVIEW_DISABLED");
  if (!/^task_[a-f0-9-]{36}$/.test(taskId)) throw new Error("INVALID_TASK_ID");
  const response = await daemonRequest(root, { action: "get", taskId }, 3_000);
  if (!response.ok) throw new Error(response.error ?? "DAEMON_UNAVAILABLE");
  const task = response.data as { workspace?: unknown } | null;
  if (
    typeof task?.workspace !== "string" ||
    !sameWorkspace(task.workspace, workspace)
  )
    throw new Error("TASK_NOT_FOUND");
  return taskId;
}

/** Cancel is explicit and workspace-scoped. Closing the Jobs view never calls this. */
export async function cancelDurableJob(
  root: string | undefined,
  workspace: string,
  taskId: string,
): Promise<unknown> {
  await verifiedTask(root, workspace, taskId);
  const response = await daemonRequest(
    root!,
    { action: "cancel", taskId },
    5_000,
  );
  if (!response.ok) throw new Error(response.error ?? "DAEMON_CANCEL_FAILED");
  return response.data;
}

/** Output is fetched only when the user opens a job, never in bulk diagnostics. */
export async function readDurableJobOutput(
  root: string | undefined,
  workspace: string,
  taskId: string,
  stream: "stdout" | "stderr",
): Promise<unknown> {
  await verifiedTask(root, workspace, taskId);
  if (stream !== "stdout" && stream !== "stderr")
    throw new Error("INVALID_OUTPUT_STREAM");
  const response = await daemonRequest(
    root!,
    { action: "output", taskId, stream, cursor: 0, maxBytes: 4_096 },
    5_000,
  );
  if (!response.ok) throw new Error(response.error ?? "DAEMON_OUTPUT_FAILED");
  return response.data;
}
