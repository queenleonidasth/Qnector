import type { MemoryRecall } from "@qnector/core";
import type { ActivityEntry } from "@qnector/shared";

const MAX_BOOTSTRAP_BYTES = 8_000;

export function buildSessionBootstrapInstructions(
  memory: MemoryRecall,
  recentActivity: ActivityEntry[] = [],
): string {
  const lines: string[] = [
    "QNECTOR SESSION BOOTSTRAP",
    "Use this continuity context before acting. Do not redo completed work; verify current files/runtime before destructive changes.",
    "",
    `Workspace: ${clip(memory.workspacePath, 500)}`,
    `Memory updated: ${memory.updatedAt}`,
  ];

  const checkpoint = memory.checkpoints[0];
  if (checkpoint) {
    lines.push(
      `Latest checkpoint: ${checkpoint.createdAt}${checkpoint.label ? ` — ${clip(checkpoint.label, 300)}` : ""}`,
    );
  } else {
    lines.push("Latest checkpoint: none saved");
  }

  if (!memory.available) {
    lines.push(
      "",
      "No saved continuity memory exists for this workspace yet. Inspect the workspace and handoff documents before changing files, then save a checkpoint after meaningful progress.",
    );
    return capUtf8(lines.join("\n"), MAX_BOOTSTRAP_BYTES);
  }

  const active = memory.state.active;
  if (active) {
    lines.push("", `Current task: ${clip(active.currentTask, 1_000)}`);
    pushList(lines, "Completed steps", active.completedSteps, 8, 320);
    pushList(lines, "Pending steps", active.pendingSteps, 12, 320);
    if (active.criticalContext) {
      lines.push("", "Critical context:", clip(active.criticalContext, 2_000));
    }
  }

  const working = recentActivity
    .filter((entry) => entry.status !== "running" && entry.tool !== "memory")
    .slice(-8)
    .reverse();
  if (working.length > 0) {
    lines.push("", "Recent working set:");
    for (const entry of working) {
      lines.push(
        `- ${entry.timestamp} ${entry.tool}.${entry.action} [${entry.status}] ${clip(entry.summary ?? entry.error?.message ?? "", 280)}`,
      );
    }
  }

  const changes = memory.state.recentChanges.slice(0, 6);
  if (changes.length > 0) {
    lines.push("", "Recent Qnector changes:");
    for (const change of changes) {
      const paths = change.paths.slice(0, 2).map((entry) => clip(entry, 180));
      lines.push(
        `- ${change.timestamp} [${change.source}] ${clip(change.summary, 320)}${paths.length ? ` (${paths.join(", ")})` : ""}`,
      );
    }
  }

  const facts = memory.state.facts.slice(0, 12);
  if (facts.length > 0) {
    lines.push("", "Core facts / decisions / rules:");
    for (const fact of facts) {
      lines.push(
        `- [${fact.category}] ${clip(fact.key, 120)}: ${clip(fact.value, 360)}`,
      );
    }
  }

  if (memory.warning)
    lines.push("", `Memory warning: ${clip(memory.warning, 500)}`);
  if (memory.truncated) {
    lines.push(
      "Memory note: bootstrap is intentionally bounded; call memory.recall when more history is required.",
    );
  }

  return capUtf8(lines.join("\n"), MAX_BOOTSTRAP_BYTES);
}

export function buildSessionBootstrapError(
  workspacePath: string,
  message: string,
): string {
  return capUtf8(
    [
      "QNECTOR SESSION BOOTSTRAP",
      `Workspace: ${clip(workspacePath, 500)}`,
      `Memory bootstrap could not be loaded: ${clip(message, 700)}`,
      "Inspect the workspace before making changes. The memory failure must not block normal Qnector tools.",
    ].join("\n"),
    MAX_BOOTSTRAP_BYTES,
  );
}

function pushList(
  lines: string[],
  title: string,
  values: string[],
  maxItems: number,
  maxChars: number,
): void {
  if (values.length === 0) return;
  lines.push("", `${title}:`);
  for (const value of values.slice(0, maxItems)) {
    lines.push(`- ${clip(value, maxChars)}`);
  }
  if (values.length > maxItems) {
    lines.push(`- … ${values.length - maxItems} more`);
  }
}

function clip(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1))}…`;
}

function capUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  const suffix = "\n… bootstrap truncated to fit Qnector context budget";
  const suffixBytes = Buffer.byteLength(suffix, "utf8");
  const budget = Math.max(0, maxBytes - suffixBytes);
  const chars = Array.from(value);
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = chars.slice(0, mid).join("");
    if (Buffer.byteLength(candidate, "utf8") <= budget) low = mid;
    else high = mid - 1;
  }
  return `${chars.slice(0, low).join("")}${suffix}`;
}
