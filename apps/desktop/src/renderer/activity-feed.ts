import type { ActivityEntry } from "@qnector/shared";

export function sameActivityCall(
  left: ActivityEntry,
  right: ActivityEntry,
): boolean {
  return (
    left.tool === right.tool &&
    left.action === right.action &&
    left.argsSummary === right.argsSummary
  );
}

export function mergeActivityEntry(
  current: ActivityEntry[],
  entry: ActivityEntry,
): ActivityEntry[] {
  const next = current.filter((item) => item.id !== entry.id);

  if (entry.status !== "running") {
    const runningIndex = next.findIndex(
      (item) => item.status === "running" && sameActivityCall(item, entry),
    );
    if (runningIndex >= 0) {
      const running = next[runningIndex]!;
      next[runningIndex] = { ...entry, id: running.id };
      return next;
    }
  }

  return [entry, ...next];
}

export function coalesceActivity(entries: ActivityEntry[]): ActivityEntry[] {
  return [...entries]
    .sort((left, right) => {
      const byTime = Date.parse(left.timestamp) - Date.parse(right.timestamp);
      return Number.isFinite(byTime) ? byTime : 0;
    })
    .reduce<ActivityEntry[]>(mergeActivityEntry, []);
}
