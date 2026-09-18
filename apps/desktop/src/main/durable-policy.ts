// The packaged Windows desktop enables the existing durable task API by default.
// The legacy tool path remains available when the daemon is unavailable.
// Set QNECTOR_DURABLE_PREVIEW=0 to opt out without touching durable job state.
export function shouldEnableDurableTasks(
  platform: NodeJS.Platform,
  override?: string,
): boolean {
  return (
    platform === "win32" &&
    !["0", "false", "off"].includes(override?.trim().toLowerCase() ?? "")
  );
}
