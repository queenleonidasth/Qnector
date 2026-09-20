import type { MemoryFact, MemoryTask } from "@qnector/shared";

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
