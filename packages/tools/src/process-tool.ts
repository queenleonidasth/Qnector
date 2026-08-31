import type { ToolDefinition, ToolResult } from "@qnector/shared";
import {
  booleanInput,
  numberInput,
  objectInput,
  runWithActivity,
  stringInput,
  type ToolContext,
} from "./tool-result.js";
import type { ProcessShell, WorkflowStep } from "@qnector/core";

export const processDefinition: ToolDefinition = {
  name: "process",
  description:
    "Run PowerShell, cmd, direct CLI commands, long-running processes, and interactive PTY/ConPTY terminals. Use start/output for background commands and pty_start/pty_read/pty_write for terminal programs that require interactive input.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "run",
          "start",
          "output",
          "stdin",
          "stop",
          "list",
          "kill_tree",
          "wait_for_exit",
          "wait_for_output",
          "wait_for_port",
          "pty_start",
          "pty_read",
          "pty_write",
          "pty_resize",
          "pty_close",
          "pty_list",
          "task_start",
          "task_get",
          "task_list",
          "task_cancel",
          "workflow_save",
          "workflow_list",
          "workflow_get",
          "workflow_start",
          "workflow_status",
          "workflow_runs",
          "workflow_cancel",
          "workflow_resume",
        ],
      },
      command: { type: "string" },
      cwd: { type: "string" },
      shell: { type: "string", enum: ["powershell", "cmd", "direct"] },
      timeoutMs: { type: "integer", minimum: 1 },
      maxChars: { type: "integer", minimum: 1 },
      maxResults: { type: "integer", minimum: 1, maximum: 200 },
      outputMode: { type: "string", enum: ["raw", "smart"] },
      env: { type: "object" },
      processId: { type: "string" },
      ptyId: { type: "string" },
      taskId: { type: "string" },
      workflowName: { type: "string" },
      runId: { type: "string" },
      description: { type: "string" },
      steps: { type: "array", items: { type: "object" }, maxItems: 100 },
      cursor: { type: "integer", minimum: 0 },
      text: { type: "string" },
      pattern: { type: "string" },
      caseSensitive: { type: "boolean" },
      host: { type: "string" },
      port: { type: "integer", minimum: 1, maximum: 65535 },
      intervalMs: { type: "integer", minimum: 50, maximum: 5000 },
      cols: { type: "integer", minimum: 2, maximum: 500 },
      rows: { type: "integer", minimum: 2, maximum: 500 },
      enter: { type: "boolean" },
    },
    required: ["action"],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
};

export async function executeProcess(
  context: ToolContext,
  input: unknown,
): Promise<ToolResult> {
  const object = objectInput(input);
  const action = stringInput(object, "action", true)!;
  return runWithActivity(context, "process", action, input, async () => {
    if (action.startsWith("workflow_")) {
      if (!context.workflowManager)
        throw new Error(
          "UNSUPPORTED_CAPABILITY: workflow engine is not configured in this Qnector runtime",
        );
      const workspace = context.getConfig().activeWorkspace;
      if (action === "workflow_save") {
        if (!Array.isArray(object.steps))
          throw new Error("INVALID_INPUT: steps must be an array");
        const definition = await context.workflowManager.save(workspace, {
          name: stringInput(object, "workflowName", true)!,
          ...(stringInput(object, "description")
            ? { description: stringInput(object, "description") }
            : {}),
          steps: object.steps as WorkflowStep[],
        });
        return {
          summary: `Saved workflow ${definition.name} with ${definition.steps.length} step(s)`,
          data: definition,
        };
      }
      if (action === "workflow_list") {
        const workflows = await context.workflowManager.list(workspace);
        return {
          summary: `Listed ${workflows.length} workflow(s)`,
          data: { workflows },
        };
      }
      if (action === "workflow_get") {
        const definition = await context.workflowManager.get(
          workspace,
          stringInput(object, "workflowName", true)!,
        );
        return {
          summary: `Read workflow ${definition.name}`,
          data: definition,
        };
      }
      if (action === "workflow_start") {
        const run = await context.workflowManager.start(
          workspace,
          stringInput(object, "workflowName", true)!,
        );
        return {
          summary: `Started workflow ${run.workflow} as ${run.runId}`,
          data: run,
        };
      }
      if (action === "workflow_runs") {
        const runs = await context.workflowManager.listRuns(
          workspace,
          numberInput(object, "maxResults", 50),
        );
        return {
          summary: `Listed ${runs.length} workflow run(s)`,
          data: { runs },
        };
      }
      const runId = stringInput(object, "runId", true)!;
      if (action === "workflow_status") {
        const run = await context.workflowManager.status(workspace, runId);
        return {
          summary: `Workflow ${run.workflow} is ${run.state}`,
          data: run,
        };
      }
      if (action === "workflow_cancel") {
        const run = await context.workflowManager.cancel(workspace, runId);
        return {
          summary: `Workflow ${run.workflow} is ${run.state}`,
          data: run,
        };
      }
      if (action === "workflow_resume") {
        const run = await context.workflowManager.resume(workspace, runId);
        return {
          summary: `Resumed workflow ${run.workflow} as ${run.runId}`,
          data: run,
        };
      }
      throw new Error(`INVALID_ACTION: Unknown workflow action '${action}'`);
    }
    if (action.startsWith("pty_")) {
      if (!context.ptyManager)
        throw new Error(
          "UNSUPPORTED_CAPABILITY: interactive PTY is not configured in this Qnector runtime",
        );
      if (action === "pty_list") {
        const sessions = context.ptyManager.list();
        return {
          summary: `Listed ${sessions.length} interactive PTY session(s)`,
          data: { sessions },
        };
      }
      if (action === "pty_start") {
        const cwd = context.workspace.resolve(stringInput(object, "cwd") ?? ".");
        const shellValue = stringInput(object, "shell") as ProcessShell | undefined;
        const shell =
          shellValue && ["powershell", "cmd", "direct"].includes(shellValue)
            ? shellValue
            : context.getConfig().shell.windows;
        const snapshot = await context.ptyManager.start({
          ...(stringInput(object, "command")
            ? { command: stringInput(object, "command") }
            : {}),
          cwd,
          shell,
          powershellPath: context.getConfig().shell.powershellPath,
          env: environmentInput(object),
          cols: numberInput(object, "cols", 120),
          rows: numberInput(object, "rows", 30),
        });
        return {
          summary: `Started interactive PTY ${snapshot.id} for ${snapshot.command}`,
          data: snapshot,
        };
      }
      const ptyId = stringInput(object, "ptyId", true)!;
      if (action === "pty_read") {
        const result = context.ptyManager.read(
          ptyId,
          Math.max(0, numberInput(object, "cursor", 0)),
          Math.max(1, Math.min(numberInput(object, "maxChars", 20_000), 100_000)),
        );
        return {
          summary: `Read ${result.text.length} characters from ${ptyId}`,
          data: result,
          truncated: result.truncated,
          nextCursor: result.nextCursor,
        };
      }
      if (action === "pty_write") {
        const text = stringInput(object, "text") ?? "";
        const result = context.ptyManager.write(
          ptyId,
          text,
          booleanInput(object, "enter", false),
        );
        return {
          summary: `Wrote ${result.bytes} byte(s) to ${ptyId}`,
          data: { ptyId, ...result },
        };
      }
      if (action === "pty_resize") {
        const cols = numberInput(object, "cols", Number.NaN);
        const rows = numberInput(object, "rows", Number.NaN);
        if (!Number.isFinite(cols) || !Number.isFinite(rows))
          throw new Error("INVALID_INPUT: cols and rows are required for pty_resize");
        const snapshot = context.ptyManager.resize(ptyId, cols, rows);
        return {
          summary: `Resized ${ptyId} to ${snapshot.cols}x${snapshot.rows}`,
          data: snapshot,
        };
      }
      if (action === "pty_close") {
        const snapshot = await context.ptyManager.close(ptyId);
        return {
          summary: `Closed interactive PTY ${ptyId}`,
          data: snapshot,
        };
      }
      throw new Error(`INVALID_ACTION: Unknown PTY action '${action}'`);
    }
    if (action === "list")
      return {
        summary: "Listed Qnector processes",
        data: { processes: context.processManager.list() },
      };
    if (action === "task_list") {
      const tasks = context.processManager.list().map((snapshot) => ({
        taskId: snapshot.id,
        ...snapshot,
      }));
      return {
        summary: `Listed ${tasks.length} durable Qnector task(s)`,
        data: { tasks, taskProtocol: "qnector-process-v1" },
      };
    }
    if (action === "task_get") {
      const taskId =
        stringInput(object, "taskId") ??
        stringInput(object, "processId", true)!;
      const snapshot = context.processManager.snapshot(taskId);
      return {
        summary: `Read durable task ${taskId}`,
        data: { taskId, ...snapshot, taskProtocol: "qnector-process-v1" },
      };
    }
    if (action === "wait_for_exit") {
      const processId =
        stringInput(object, "processId") ??
        stringInput(object, "taskId", true)!;
      const snapshot = await context.processManager.waitForExit(
        processId,
        numberInput(object, "timeoutMs", 120_000),
      );
      return {
        summary: `${processId} reached ${snapshot.state}`,
        data: snapshot,
      };
    }
    if (action === "wait_for_output") {
      const processId =
        stringInput(object, "processId") ??
        stringInput(object, "taskId", true)!;
      const result = await context.processManager.waitForOutput({
        processId,
        pattern: stringInput(object, "pattern", true)!,
        cursor: numberInput(object, "cursor", 0),
        timeoutMs: numberInput(object, "timeoutMs", 60_000),
        caseSensitive: booleanInput(object, "caseSensitive", false),
      });
      return {
        summary: `Observed '${result.matched}' in output from ${processId}`,
        data: result,
        truncated: result.truncated,
        nextCursor: result.nextCursor,
      };
    }
    if (action === "wait_for_port") {
      const result = await context.processManager.waitForPort({
        host: stringInput(object, "host") ?? "127.0.0.1",
        port: numberInput(object, "port", Number.NaN),
        timeoutMs: numberInput(object, "timeoutMs", 60_000),
        intervalMs: numberInput(object, "intervalMs", 200),
      });
      return {
        summary: `${result.host}:${result.port} accepted connections after ${result.elapsedMs} ms`,
        data: result,
      };
    }
    if (action === "output") {
      const processId = stringInput(object, "processId", true)!;
      const result = context.processManager.output(
        processId,
        Math.max(0, numberInput(object, "cursor", 0)),
        Math.max(1, Math.min(numberInput(object, "maxChars", 20_000), 100_000)),
        outputMode(object, "raw"),
      );
      return {
        summary: `Read ${result.text.length} characters from ${processId}`,
        data: result,
        truncated: result.truncated,
        nextCursor: result.nextCursor,
      };
    }
    if (action === "stdin") {
      const processId = stringInput(object, "processId", true)!;
      await context.processManager.stdin(
        processId,
        stringInput(object, "text", true)!,
      );
      return {
        summary: `Sent stdin to ${processId}`,
        data: {
          processId,
          bytes: Buffer.byteLength(stringInput(object, "text", true)!, "utf8"),
        },
      };
    }
    if (
      action === "stop" ||
      action === "kill_tree" ||
      action === "task_cancel"
    ) {
      const processId =
        stringInput(object, "processId") ??
        stringInput(object, "taskId", true)!;
      const snapshot =
        action === "kill_tree"
          ? await context.processManager.killTree(processId)
          : await context.processManager.stop(processId);
      return {
        summary: `${action === "kill_tree" ? "Killed tree for" : action === "task_cancel" ? "Canceled task" : "Stopped"} ${processId}`,
        data:
          action === "task_cancel"
            ? {
                taskId: processId,
                ...snapshot,
                taskProtocol: "qnector-process-v1",
              }
            : snapshot,
      };
    }
    const command = stringInput(object, "command", true)!;
    const cwd = context.workspace.resolve(stringInput(object, "cwd") ?? ".");
    const shellValue = stringInput(object, "shell") as ProcessShell | undefined;
    const shell =
      shellValue && ["powershell", "cmd", "direct"].includes(shellValue)
        ? shellValue
        : context.getConfig().shell.windows;
    const env: Record<string, string> = {};
    if (
      object.env &&
      typeof object.env === "object" &&
      !Array.isArray(object.env)
    ) {
      for (const [key, value] of Object.entries(
        object.env as Record<string, unknown>,
      )) {
        if (typeof value === "string") env[key] = value;
      }
    }
    const powershellPath = context.getConfig().shell.powershellPath;
    if (powershellPath) env.QNECTOR_POWERSHELL_PATH = powershellPath;
    if (action === "start" || action === "task_start") {
      const snapshot = context.processManager.start({
        command,
        cwd,
        shell,
        timeoutMs: numberInput(
          object,
          "timeoutMs",
          context.getConfig().shell.defaultTimeoutMs,
        ),
        env,
      });
      return action === "task_start"
        ? {
            summary: `Started durable task for ${command}`,
            data: {
              taskId: snapshot.id,
              ...snapshot,
              taskProtocol: "qnector-process-v1",
            },
          }
        : { summary: `Started ${command}`, data: snapshot };
    }
    if (action === "run") {
      const result = await context.processManager.run({
        command,
        cwd,
        shell,
        timeoutMs: numberInput(
          object,
          "timeoutMs",
          context.getConfig().shell.defaultTimeoutMs,
        ),
        env,
        maxChars: Math.max(
          1,
          Math.min(numberInput(object, "maxChars", 100_000), 1_000_000),
        ),
        outputMode: outputMode(object),
      });
      const timeoutMs = numberInput(
        object,
        "timeoutMs",
        context.getConfig().shell.defaultTimeoutMs,
      );
      if (result.exitCode === null && result.durationMs >= timeoutMs)
        throw new Error(`COMMAND_TIMEOUT: Command exceeded ${timeoutMs} ms`);
      return {
        summary: `Command exited with code ${result.exitCode ?? "null"}`,
        data: result,
        truncated: result.truncated,
        nextCursor: null,
      };
    }
    throw new Error(`INVALID_ACTION: Unknown process action '${action}'`);
  });
}

function outputMode(
  object: Record<string, unknown>,
  fallback: "raw" | "smart" = "smart",
): "raw" | "smart" {
  const value = stringInput(object, "outputMode");
  if (!value) return fallback;
  if (value !== "raw" && value !== "smart")
    throw new Error(`INVALID_INPUT: outputMode must be raw or smart`);
  return value;
}


function environmentInput(object: Record<string, unknown>): Record<string, string> {
  const env: Record<string, string> = {};
  if (object.env && typeof object.env === "object" && !Array.isArray(object.env)) {
    for (const [key, value] of Object.entries(object.env as Record<string, unknown>)) {
      if (typeof value === "string") env[key] = value;
    }
  }
  return env;
}
