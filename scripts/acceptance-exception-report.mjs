import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const validStatuses = new Set(["PASS", "FAIL", "SKIPPED", "UNKNOWN"]);
const followups = {
  "public-api-golden": "Inspect manifest versus actual grouped MCP tools, preserve retired tool exclusions.",
  "typecheck": "Fix exact TypeScript diagnostics, then rerun only the affected source checks.",
  "test": "Inspect failing test names in JSON evidence and add a reproducible minimal regression fixture.",
  "lint": "Inspect ESLint errors and correct the affected source without suppressing rules.",
  "http-mcp-smoke": "Inspect isolated local MCP initialization/tools/list and request/response validation.",
  "local-performance": "Inspect client-observed baseline/candidate timing and correctness checks.",
  "semantic-search": "Inspect same-fixture indexing, cache invalidation and output hash parity.",
  "git-diff-check": "Inspect Git whitespace or unexpectedly modified tracked source.",
  "stdio-packaged": "Build a clean exact-commit Windows candidate and verify stdio and SHA256 resources.",
  "tunnel": "Requires separately authorized candidate tunnel; user waived companion-app testing.",
  "electron-gui": "Run isolated packaged Qnector GUI and validate the exact-commit GUI evidence envelope.",
  "chatgpt-host": "Requires separately authorized ChatGPT connector to the candidate; user waived companion-app testing.",
  "controlled-performance-suite": "Gather actual exact-commit full cold, CPU/RAM, payload, p95 CI and regression evidence; avoid synthetic pass.",
  "native-build": "Verify native UIA/Job Host artifacts and packaged durable recovery on an exact clean revision.",
};

export function renderAcceptanceExceptions(report) {
  if (!report || !Array.isArray(report.gates) || typeof report.revision !== "string" ||
      !/^[a-f0-9]{40}$/i.test(report.revision)) {
    throw new Error("INVALID_ACCEPTANCE_REPORT: missing exact revision or gates");
  }
  const counts = { PASS: 0, FAIL: 0, SKIPPED: 0, UNKNOWN: 0 };
  for (const entry of report.gates) {
    if (!entry || !validStatuses.has(entry.status)) {
      throw new Error("INVALID_ACCEPTANCE_GATE_STATUS");
    }
    counts[entry.status]++;
  }
  const lines = [
    "# QNECTOR acceptance — unresolved QA checks",
    "",
    "Revision: " + report.revision,
    "Recorded: " + (report.generatedAt || "unspecified"),
    "Result: " + counts.PASS + " PASS, " + counts.FAIL + " FAIL, " +
      counts.SKIPPED + " SKIPPED, " + counts.UNKNOWN + " UNKNOWN",
    "Local validation eligible: " + Boolean(report.localValidationEligible),
    "Public release eligible: " + Boolean(report.releaseEligible),
    "",
    "Do not count SKIPPED or UNKNOWN as PASS. A failed or unavailable check does not prevent unrelated engineering work, but it blocks claiming an all-PASS release.",
    "Evidence details remain in task12-acceptance-report.json; output from commands and secrets are deliberately not copied into this exception summary.",
    "",
    "| Status | Gate | Next independent action / revisit condition |",
    "|---|---|---|",
  ];
  const unresolved = report.gates.filter(entry => entry.status !== "PASS");
  if (!unresolved.length) {
    lines.push("| — | — | No failed, skipped or unknown gates |");
  } else {
    for (const entry of unresolved) {
      const gateName = String(entry.gate ?? "unknown").replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 100);
      const next = followups[gateName] || "Inspect the JSON source evidence, write a focused test and resume when the cause changes.";
      lines.push("| " + entry.status + " | " + gateName + " | " + next + " |");
    }
  }
  lines.push("", "Continue another independent task. Do not automatically retry a failed operation or publish, tag, install or promote an unverified candidate.", "");
  return lines.join("\n");
}

export async function writeAcceptanceExceptions(report, outputDirectory) {
  if (typeof outputDirectory !== "string" || !outputDirectory.trim()) {
    throw new Error("INVALID_EXCEPTION_OUTPUT_DIRECTORY");
  }
  const full = path.resolve(outputDirectory);
  await mkdir(full, { recursive: true });
  const basename = "acceptance-exceptions-" + report.revision.slice(0, 12) + ".md";
  const finalPath = path.join(full, basename);
  const tempPath = finalPath + ".tmp-" + process.pid + "-" + Date.now();
  try {
    await writeFile(tempPath, renderAcceptanceExceptions(report), { encoding: "utf8", flag: "wx" });
    await rename(tempPath, finalPath);
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
  return finalPath;
}
