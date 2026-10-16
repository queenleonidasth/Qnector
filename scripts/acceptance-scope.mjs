/**
 * Local-only acceptance never replaces full release acceptance. Explicit external-app
 * waivers are reported as SKIPPED, never PASS, and cannot hide real failures.
 */
const concurrentAppGates = new Set(["tunnel", "chatgpt-host"]);
export function classifyGate(gate, options = {}) {
  return options.skipConcurrentApps && concurrentAppGates.has(gate)
    ? "WAIVABLE_EXTERNAL" : "REQUIRED";
}
export function assessAcceptance(gates, options = {}) {
  const normalized = gates.map(item => {
    if (item.status !== "UNKNOWN" || classifyGate(item.gate, options) !== "WAIVABLE_EXTERNAL")
      return { ...item };
    return { ...item, status: "SKIPPED", evidence: item.evidence + " User explicitly excluded tests requiring concurrent external programs; unverified, not PASS." };
  });
  return {
    gates: normalized,
    waivedGates: normalized.filter(x => x.status === "SKIPPED").map(x => x.gate),
    localValidationEligible: normalized.every(x => x.status === "PASS" || x.status === "SKIPPED"),
    releaseEligible: normalized.every(x => x.status === "PASS"),
  };
}
