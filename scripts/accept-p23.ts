import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ActivityLogger, defaultConfig } from "../packages/core/src/index.js";
import { QnectorRuntime } from "../packages/mcp-server/src/server.js";
import type { ToolResult } from "../packages/shared/src/types.js";

if (process.platform !== "win32")
  throw new Error("P23 real acceptance is Windows/ConPTY-specific");

const root = await mkdtemp(path.join(os.tmpdir(), "qnector-p23-"));
const checks: Record<string, unknown> = {};

try {
  const runtime = new QnectorRuntime({
    config: {
      ...defaultConfig(root),
      transport: { mode: "local-only" as const },
    },
    logger: new ActivityLogger(path.join(root, "activity.jsonl")),
  });

  const started = unwrap<{
    id: string;
    pid: number;
    state: string;
    cols: number;
    rows: number;
  }>(
    await runtime.registry.call("process", runtime.context(), {
      action: "pty_start",
      shell: "cmd",
      cols: 90,
      rows: 28,
    }),
  );
  assert(started.state === "running" && started.pid > 0, "pty_start did not create a running ConPTY session");

  await call(runtime, {
    action: "pty_write",
    ptyId: started.id,
    text: "@set /p P23_VALUE=P23_PROMPT:",
    enter: true,
  });
  await delay(150);
  await call(runtime, {
    action: "pty_write",
    ptyId: started.id,
    text: "QNECTOR23",
    enter: true,
  });
  await call(runtime, {
    action: "pty_write",
    ptyId: started.id,
    text: "@echo P23_INTERACTIVE_%P23_VALUE%",
    enter: true,
  });

  const interactive = await readUntil(runtime, started.id, "P23_INTERACTIVE_QNECTOR23");
  checks.interactiveInput = interactive.includes("P23_INTERACTIVE_QNECTOR23");

  const resized = unwrap<{ cols: number; rows: number }>(
    await runtime.registry.call("process", runtime.context(), {
      action: "pty_resize",
      ptyId: started.id,
      cols: 132,
      rows: 40,
    }),
  );
  assert(resized.cols === 132 && resized.rows === 40, "pty_resize did not persist the requested dimensions");
  checks.resize = `${resized.cols}x${resized.rows}`;

  const listed = unwrap<{ sessions: Array<{ id: string; state: string }> }>(
    await runtime.registry.call("process", runtime.context(), {
      action: "pty_list",
    }),
  );
  assert(listed.sessions.some((entry) => entry.id === started.id), "pty_list did not include the active session");
  checks.list = listed.sessions.length;

  const closed = unwrap<{ state: string }>(
    await runtime.registry.call("process", runtime.context(), {
      action: "pty_close",
      ptyId: started.id,
    }),
  );
  assert(closed.state === "stopped", `pty_close returned unexpected state ${closed.state}`);

  const closedRead = unwrap<{ state: string; text: string }>(
    await runtime.registry.call("process", runtime.context(), {
      action: "pty_read",
      ptyId: started.id,
      cursor: 0,
      maxChars: 100_000,
    }),
  );
  assert(closedRead.state === "stopped", "pty_read did not preserve closed-session history");
  checks.closedHistory = closedRead.text.includes("P23_INTERACTIVE_QNECTOR23");

  const powershell = unwrap<{ id: string; state: string; executable: string }>(
    await runtime.registry.call("process", runtime.context(), {
      action: "pty_start",
      shell: "powershell",
      cols: 100,
      rows: 30,
    }),
  );
  try {
    await call(runtime, {
      action: "pty_write",
      ptyId: powershell.id,
      text: "Write-Output P23_POWERSHELL_OK",
      enter: true,
    });
    await readUntil(runtime, powershell.id, "P23_POWERSHELL_OK");
    checks.powershell = powershell.executable;
  } finally {
    await call(runtime, { action: "pty_close", ptyId: powershell.id });
  }

  const doctor = unwrap<{
    checks: Array<{ name: string; status: string }>;
    healthy: boolean;
  }>(
    await runtime.registry.call("system", runtime.context(), { action: "doctor" }),
  );
  const ptyDoctor = doctor.checks.find((entry) => entry.name === "interactive-pty");
  assert(ptyDoctor?.status === "pass", "system.doctor did not report interactive-pty as pass");
  checks.doctor = ptyDoctor;

  console.log(JSON.stringify({ ok: true, p23: checks }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}

async function call(runtime: QnectorRuntime, input: Record<string, unknown>): Promise<unknown> {
  return unwrap(await runtime.registry.call("process", runtime.context(), input));
}

async function readUntil(
  runtime: QnectorRuntime,
  ptyId: string,
  expected: string,
): Promise<string> {
  const deadline = Date.now() + 7_500;
  while (Date.now() < deadline) {
    const result = unwrap<{ text: string; state: string }>(
      await runtime.registry.call("process", runtime.context(), {
        action: "pty_read",
        ptyId,
        cursor: 0,
        maxChars: 100_000,
      }),
    );
    if (result.text.includes(expected)) return result.text;
    if (result.state !== "running")
      throw new Error(`PTY exited before '${expected}' appeared: ${result.text}`);
    await delay(50);
  }
  throw new Error(`Timed out waiting for PTY output '${expected}'`);
}

function unwrap<T>(result: ToolResult): T {
  if (!result.ok)
    throw new Error(
      `${result.error?.code ?? "TOOL_ERROR"}: ${result.error?.message ?? result.summary}`,
    );
  const outer = result.data as { data?: unknown } | undefined;
  return (outer?.data ?? outer) as T;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
