import type { MemoryFact, MemoryTask, MemoryV2Event } from "@qnector/shared";

export interface DisplayMemory {
  id: string;
  key: string;
  value: string;
  category: string;
  updatedAt: string;
  source: "Memory v2" | "Legacy";
  scope?: "workspace" | "task";
  taskId?: string | null;
  taskTitle?: string | null;
}

/** Keep source identity: identical text is not proof of a migration match. */
export function presentMemories(
  v2: readonly MemoryFact[],
  legacy: readonly (Pick<MemoryFact, "id" | "key" | "value" | "updatedAt"> & {
    category: string;
  })[],
): DisplayMemory[] {
  return [
    ...v2.map((item) => ({ ...item, source: "Memory v2" as const })),
    ...legacy.map((item) => ({ ...item, source: "Legacy" as const })),
  ];
}

export function filterMemories(
  records: readonly DisplayMemory[],
  query: string,
): DisplayMemory[] {
  const needle = query.trim().toLocaleLowerCase();
  return records.filter((item) =>
    `${item.key} ${item.value} ${item.category} ${item.source}`
      .toLocaleLowerCase()
      .includes(needle),
  );
}

export function pendingTasks(tasks: readonly MemoryTask[]): MemoryTask[] {
  return tasks.filter(
    (task) => task.status === "active" || task.status === "blocked",
  );
}

export function visibleCount(total: number, pageSize: number): number {
  return Math.min(total, Math.max(0, pageSize));
}

/** Task context is not a transcript. Only session-linked tasks can name a saved session topic. */
export function latestLinkedSessionTask(
  tasks: readonly MemoryTask[],
): MemoryTask | undefined {
  return [...tasks]
    .filter((task) => task.sessionCount > 0)
    .sort((a, b) =>
      (b.lastEventAt ?? b.updatedAt).localeCompare(
        a.lastEventAt ?? a.updatedAt,
      ),
    )[0];
}

/** Latest persisted Qnector task activity, including the general workspace bucket. */
export function latestSavedActivityTask(
  tasks: readonly MemoryTask[],
): MemoryTask | undefined {
  return [...tasks].sort((a, b) =>
    (b.lastEventAt ?? b.updatedAt).localeCompare(a.lastEventAt ?? a.updatedAt),
  )[0];
}
/** Never display idle/completed historical tasks as current work. */
export function currentSavedTask(
  tasks: readonly MemoryTask[],
): MemoryTask | undefined {
  const latest = (status: MemoryTask["status"]) =>
    [...tasks]
      .filter((task) => task.status === status)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return latest("active") ?? latest("blocked");
}

export interface DisplayLogEntry {
  id: string;
  timestamp: string;
  summary: string;
  source: "Memory v2" | "Legacy";
  status?: MemoryV2Event["status"];
  action?: string;
}

/** Preserve provenance and show only a bounded newest-first slice of saved events. */
export function recentSavedLog(
  events: readonly MemoryV2Event[],
  changes: readonly { timestamp: string; summary: string }[],
  limit = 12,
): DisplayLogEntry[] {
  return [
    ...events.map((event) => ({
      id: `v2-${event.id}`,
      timestamp: event.timestamp,
      summary: event.summary,
      source: "Memory v2" as const,
      status: event.status,
      action: `${event.source}.${event.action}`,
    })),
    ...changes.map((change, index) => ({
      id: `legacy-${index}-${change.timestamp}`,
      timestamp: change.timestamp,
      summary: change.summary,
      source: "Legacy" as const,
    })),
  ]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, Math.max(0, limit));
}
