import { createHash } from "node:crypto";

const requiredWorkloads = [
  "browser-cdp", "documents", "fallback-search", "process-pool",
  "read-many", "recipes", "search", "startup", "uia",
];

const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Evidence files use { payload, sha256 }; digest binds all claims against accidental edits. */
export function validateEvidenceEnvelope(envelope, { revision, kind, now = Date.now(), maxAgeMs = 7 * 86400_000 } = {}) {
  const payload = envelope?.payload;
  if (!payload || typeof envelope.sha256 !== "string" || digest(payload) !== envelope.sha256)
    return { status: "UNKNOWN", evidence: `${kind} evidence missing or checksum invalid.` };
  const timestamp = Date.parse(payload.observedAt ?? payload.generatedAt ?? "");
  if (payload.revision !== revision || !Number.isFinite(timestamp) || timestamp > now || now - timestamp > maxAgeMs)
    return { status: "UNKNOWN", evidence: `${kind} evidence is stale, future-dated, or for another candidate revision.` };
  if (payload.synthetic === true || payload.candidateConfirmed !== true)
    return { status: "UNKNOWN", evidence: `${kind} requires confirmed candidate-host evidence; synthetic or unconfirmed evidence is not accepted.` };
  if (payload.result !== "PASS" || typeof payload.artifact !== "string" || !payload.artifact.trim())
    return { status: "UNKNOWN", evidence: `${kind} has no passing observation and artifact reference.` };
  return { status: "PASS", evidence: `${kind} candidate evidence verified for ${revision}: ${payload.artifact}` };
}

export function validateControlledSuite(suite, revision) {
  if (!suite || suite.candidateRevision !== revision || suite.synthetic === true || suite.candidateConfirmed !== true)
    return { status: "UNKNOWN", evidence: "Full controlled suite evidence is absent, synthetic, unconfirmed, or for another candidate revision." };
  const workloads = new Map((suite.workloads ?? []).map((item) => [item.name, item]));
  for (const name of requiredWorkloads) {
    const item = workloads.get(name);
    if (!item || item.result !== "PASS" || item.warmups < 5 || item.samplesPerVariant < 30 || item.coldStartsPerVariant < 10 ||
      item.outputSha256?.baseline !== item.outputSha256?.candidate || !item.resourceSamples)
      return { status: "UNKNOWN", evidence: `Full controlled suite incomplete: ${name} requires correctness parity, 5 warmups, 30 samples, 10 cold starts and resource sampling.` };
  }
  return { status: "PASS", evidence: `All ${requiredWorkloads.length} controlled workloads have candidate-confirmed ABBA and correctness/resource evidence.` };
}

export function evidenceDigest(payload) { return digest(payload); }
