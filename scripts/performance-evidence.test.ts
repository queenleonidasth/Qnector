import { describe, expect, it } from "vitest";
import { evidenceDigest, validateControlledSuite, validateEvidenceEnvelope } from "./performance-evidence.mjs";

const now = Date.parse("2026-10-16T00:00:00.000Z");
const envelope = (payload: Record<string, unknown>) => ({ payload, sha256: evidenceDigest(payload) });

describe("revision-bound acceptance evidence", () => {
  it("accepts only a fresh, checksum-valid confirmed candidate observation", () => {
    const payload = { revision: "abc", observedAt: "2026-10-15T12:00:00.000Z", candidateConfirmed: true, synthetic: false, result: "PASS", artifact: "host-refresh.json" };
    expect(validateEvidenceEnvelope(envelope(payload), { revision: "abc", kind: "host", now }).status).toBe("PASS");
    expect(validateEvidenceEnvelope({ ...envelope(payload), payload: { ...payload, result: "FAIL" } }, { revision: "abc", kind: "host", now }).status).toBe("UNKNOWN");
  });

  it("rejects tampered and stale commit evidence", () => {
    const payload = { revision: "old", observedAt: "2026-10-01T00:00:00.000Z", candidateConfirmed: true, synthetic: false, result: "PASS", artifact: "host.json" };
    expect(validateEvidenceEnvelope({ ...envelope(payload), payload: { ...payload, revision: "new" } }, { revision: "new", kind: "host", now }).status).toBe("UNKNOWN");
    expect(validateEvidenceEnvelope(envelope(payload), { revision: "new", kind: "host", now }).status).toBe("UNKNOWN");
  });

  it("keeps partial or synthetic workload reports UNKNOWN", () => {
    expect(validateControlledSuite({ candidateRevision: "abc", candidateConfirmed: true, synthetic: true, workloads: [] }, "abc").status).toBe("UNKNOWN");
    expect(validateControlledSuite({ candidateRevision: "old", candidateConfirmed: true, workloads: [] }, "abc").status).toBe("UNKNOWN");
  });
});
