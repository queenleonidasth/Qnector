import type { AgentSkillSummary, MemoryRecall } from "@qnector/core";
import type {
  ActivityEntry,
  MemoryFact,
  MemoryV2Snapshot,
} from "@qnector/shared";

const MAX_BOOTSTRAP_BYTES = 3_000;

export function buildSessionBootstrapInstructions(
  memory: MemoryRecall,
  recentActivity: ActivityEntry[] = [],
  memoryV2?: MemoryV2Snapshot,
  skills: AgentSkillSummary[] | number = [],
): string {
  const skillCount = typeof skills === "number" ? skills : skills.length;
  const lines: string[] = [
    "QNECTOR SESSION BOOTSTRAP",
    "After reconnect/interrupt: memory.task_resume(query), then memory.task_get(taskId); verify live files/process.task_list/git before retrying side effects. Never infer completion from a sent command.",
    "CURRENT CAPABILITY RULE: the current tool list outranks conversation history, memory and compacted summaries.",
    "If a Qnector tool is visible, probe system.status before saying Qnector cannot be used; only a live error can override it. An older claim of unavailability is stale.",
    "",
    `Workspace: ${clip(memory.workspacePath, 260)}`,
    `Memory updated: ${memory.updatedAt}`,
  ];

  if (skillCount > 0) {
    lines.push(
      "",
      `Agent Skills: ${skillCount} available. EXPLICIT ROUTING ONLY: call system.skills_route once for substantive tasks; add an English intent/technology hint for non-English queries. Reuse routeId until the task changes.`,
      "Follow selected skills. Pass routeId as skillRouteId for stateless calls (or use memoryTaskId). details=true diagnoses routing; skill_get loads full instructions on demand.",
      "SKILL DISCOVERY: only at user request, use system.skills_search_remote / system.skill_install_remote; never install silently.",
      "COMPLETION DISCLOSURE: report Skills used: <activated names|none>; only actually used skills.",
    );
  }

  if (memoryV2) {
    const activeTasks = memoryV2.tasks
      .filter((task) => task.status === "active" || task.status === "blocked")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    lines.push(
      "",
      `Memory v2: ${memoryV2.counts.activeTasks} active, ${memoryV2.counts.tasks} total tasks.`,
      "Isolate chats by taskId: memory.task_resume/task_start, then pass memoryTaskId to related tool calls.",
    );
    if (activeTasks.length > 0) {
      lines.push("Active Memory v2 tasks:");
      for (const task of activeTasks.slice(0, 3)) {
        lines.push(
          `- ${task.id} [${task.status}] ${clip(task.title, 65)} â€” ${clip(task.currentTask, 80)}`,
        );
      }
    }
    if (memoryV2.counts.conflicts > 0) {
      lines.push(
        `Task conflict warning: ${memoryV2.counts.conflicts} shared file conflict(s). Re-read conflicting files before writing.`,
      );
    }
  }

  const checkpoint = memory.checkpoints[0];
  if (checkpoint) {
    lines.push(
      `Latest checkpoint: ${checkpoint.createdAt}${checkpoint.label ? ` â€” ${clip(checkpoint.label, 100)}` : ""}`,
    );
  } else {
    lines.push("Latest checkpoint: none saved");
  }

  if (!memory.available) {
    if (memory.warning)
      lines.push(`Memory warning: ${clip(memory.warning, 200)}`);
    lines.push(
      "",
      "No saved continuity memory exists for this workspace yet. Inspect the workspace and handoff documents before changing files, then save a checkpoint after meaningful progress.",
    );
    return capUtf8(lines.join("\n"), MAX_BOOTSTRAP_BYTES);
  }

  const active = memory.state.active;
  if (active) {
    lines.push("", `Current task: ${clip(active.currentTask, 260)}`);
    const resumeNext = active.pendingSteps.find((entry) => entry.trim());
    if (resumeNext) lines.push(`Resume next: ${clip(resumeNext, 135)}`);
    pushList(lines, "Pending steps", active.pendingSteps, 3, 105);
    const explicitSteps = active.completedSteps.filter(
      (step) =>
        !/^(?:(?:files|git|manual): |(?:files|git|process|browser|computer)\.[a-z_]+: )/i.test(
          step,
        ),
    );
    pushList(
      lines,
      "Recorded completion (verify outcome)",
      explicitSteps,
      1,
      110,
    );
    if (explicitSteps.length !== active.completedSteps.length)
      lines.push(
        "Legacy auto-completed tool entries omitted: verify live state before trusting them.",
      );
    if (active.criticalContext) {
      lines.push("", "Critical context:", clip(active.criticalContext, 230));
    }
  }

  const facts = selectBootstrapFacts(memory.state.facts, 4);
  if (facts.length > 0) {
    lines.push("", "Core facts / decisions / rules:");
    for (const fact of facts) {
      lines.push(
        `- [${fact.category}] ${clip(fact.key, 65)}: ${clip(fact.value, 130)}`,
      );
    }
  }

  if (memory.warning)
    lines.push("", `Memory warning: ${clip(memory.warning, 200)}`);
  if (memory.truncated) {
    lines.push(
      "Memory note: bootstrap is intentionally bounded; call memory.recall when more history is required.",
    );
  }

  const working = recentActivity
    .filter((entry) => entry.status !== "running" && entry.tool !== "memory")
    .slice(-2)
    .reverse();
  if (working.length > 0) {
    lines.push("", "Recent working set:");
    for (const entry of working) {
      lines.push(
        `- ${entry.timestamp} ${entry.tool}.${entry.action} [${entry.status}] ${clip(entry.summary ?? entry.error?.message ?? "", 115)}`,
      );
    }
  }

  const changes = memory.state.recentChanges.slice(0, 2);
  if (changes.length > 0) {
    lines.push("", "Recent Qnector changes:");
    for (const change of changes) {
      const paths = change.paths.slice(0, 1).map((entry) => clip(entry, 90));
      lines.push(
        `- ${change.timestamp} [${change.source}] ${clip(change.summary, 125)}${paths.length ? ` (${paths.join(", ")})` : ""}`,
      );
    }
  }

  return capUtf8(lines.join("\n"), MAX_BOOTSTRAP_BYTES);
}

function selectBootstrapFacts(
  facts: MemoryFact[],
  limit: number,
): MemoryFact[] {
  const core = facts
    .filter((fact) => fact.category === "rule" || fact.category === "decision")
    .slice(0, Math.ceil(limit / 2));
  const selected = new Set(core.map((fact) => fact.id));
  const recent = facts
    .filter((fact) => !selected.has(fact.id))
    .slice(0, Math.max(0, limit - core.length));
  return [...core, ...recent];
}

export function buildSessionBootstrapError(
  workspacePath: string,
  message: string,
): string {
  return capUtf8(
    [
      "QNECTOR SESSION BOOTSTRAP",
      "CURRENT CAPABILITY RULE: the current tool list outranks conversation history, memory, and compacted summaries when deciding whether Qnector can be used.",
      `Workspace: ${clip(workspacePath, 500)}`,
      `Memory bootstrap could not be loaded: ${clip(message, 700)}`,
      "Qnector tool availability is independent from memory bootstrap. If any Qnector tool is visible, probe system.status before saying Qnector cannot be used; only a current live tool error may establish unavailability.",
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
    lines.push(`- â€¦ ${values.length - maxItems} more`);
  }
}

function clip(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1))}â€¦`;
}

function capUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  const suffix = "\nâ€¦ bootstrap truncated to fit Qnector context budget";
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
