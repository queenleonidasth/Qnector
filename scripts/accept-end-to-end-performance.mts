import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { findVerifiedPackage } from "./package-evidence.mjs";
import { evidenceDigest, validateControlledSuite, validateEvidenceEnvelope } from "./performance-evidence.mjs";
import { assessAcceptance } from "./acceptance-scope.mjs";
import { writeAcceptanceExceptions } from "./acceptance-exception-report.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await readFile(path.join(root, "fixtures/performance/manifest.json"), "utf8"),
) as { tools: Array<{ name: string; actions: string[] }>; hostAliases: Array<{ name: string; actions: string[] }> };
const results: Array<{ gate: string; status: "PASS" | "FAIL" | "UNKNOWN"; evidence: string }> = [];

async function command(gate: string, file: string, args: string[]): Promise<void> {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      cwd: root,
      windowsHide: true,
      timeout: 30 * 60 * 1000,
      maxBuffer: 16 * 1024 * 1024,
    });
    results.push({ gate, status: "PASS", evidence: (stdout + stderr).trim().slice(-4000) || "exit 0" });
  } catch (error) {
    const e = error as Error & { code?: number; stdout?: string; stderr?: string };
    results.push({ gate, status: "FAIL", evidence: `${e.message}\n${e.stdout ?? ""}\n${e.stderr ?? ""}`.slice(-4000) });
  }
}

const expectedTools = ["system", "workspace", "files", "process", "git", "memory", "browser", "computer"];
const expectedHostAliases = ["system.timeout_probe", "tasks"];
function namesEqual(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length &&
    JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}
if (!namesEqual(manifest.tools.map((tool) => tool.name), expectedTools) ||
    !namesEqual(manifest.hostAliases.map((alias) => alias.name), expectedHostAliases)) {
  results.push({ gate: "public-api-golden", status: "FAIL", evidence: "Expected 8 grouped tools and 2 opt-in aliases, with all retired planning endpoints absent; see fixtures/performance/manifest.json." });
}
if (!results.some((result) => result.gate === "public-api-golden")) {
  results.push({ gate: "public-api-golden", status: "PASS", evidence: `${manifest.tools.length} supported grouped tools, ${manifest.hostAliases.length} opt-in aliases; see public-api-contract.test.ts for actions, fields, permissions and legacy shape assertions` });
}

// Node 22+ on Windows cannot execFile a .cmd/.bat script directly.
// Pass only fixed, trusted acceptance commands through cmd.exe; never
// interpolate user-provided arguments or paths into the shell string.
for (const [gate, script] of [
  ["typecheck", "typecheck"],
  ["test", "test:acceptance"],
  ["lint", "lint"],
  ["http-mcp-smoke", "smoke:mcp"],
  ["local-performance", "accept:performance"],
  ["semantic-search", "accept:search-performance"],
] as const) {
  if (process.platform === "win32") {
    await command(gate, process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `npx.cmd pnpm@10.15.0 ${script}`]);
  } else {
    await command(gate, "npx", ["pnpm@10.15.0", script]);
  }
}

const gitDiff = await commandResult("git", ["diff", "--check"]);
results.push({ gate: "git-diff-check", status: gitDiff.code === 0 ? "PASS" : "FAIL", evidence: gitDiff.output || (gitDiff.code === 0 ? "clean" : "git diff --check failed") });
const expectedCommit = (await commandResult("git", ["rev-parse", "HEAD"])).output.trim();
async function evidenceFile(gate: string, variable: string) {
  const file = process.env[variable];
  if (!file) return { status: "UNKNOWN" as const, evidence: `No ${gate} evidence file supplied (${variable}); gate remains UNKNOWN.` };
  try {
    const envelope = JSON.parse(await readFile(path.resolve(file), "utf8"));
    return validateEvidenceEnvelope(envelope, { revision: expectedCommit, kind: gate });
  } catch (error) {
    return { status: "UNKNOWN" as const, evidence: `${gate} evidence could not be read: ${(error as Error).message}` };
  }
}
const packageEvidence = findVerifiedPackage(expectedCommit);
results.push({ gate: "stdio-packaged", status: packageEvidence?.smokeVerified ? "PASS" : "UNKNOWN",
  evidence: packageEvidence ? `Verified exact-commit package with compiled stdio smoke, SHA256 resources and binaries: ${packageEvidence.packageDirectory}`
    : "No verified, exact-commit clean packaged artifact with stdio smoke; run scripts/package-windows.ps1." });
results.push({ gate: "tunnel", ...await evidenceFile("tunnel", "QNECTOR_TUNNEL_EVIDENCE") });
results.push({ gate: "electron-gui", ...await evidenceFile("electron GUI", "QNECTOR_GUI_EVIDENCE") });
results.push({ gate: "chatgpt-host", ...await evidenceFile("ChatGPT candidate host", "QNECTOR_CHATGPT_HOST_EVIDENCE") });
try {
  const file = process.env.QNECTOR_CONTROLLED_SUITE_EVIDENCE;
  const envelope = file ? JSON.parse(await readFile(path.resolve(file), "utf8")) : undefined;
  const suite = envelope?.payload && envelope.sha256 === evidenceDigest(envelope.payload) ? envelope.payload : undefined;
  results.push({ gate: "controlled-performance-suite", ...validateControlledSuite(suite, expectedCommit) });
} catch (error) {
  results.push({ gate: "controlled-performance-suite", status: "UNKNOWN", evidence: `Controlled suite evidence unreadable: ${(error as Error).message}` });
}
results.push({ gate: "native-build", status: packageEvidence?.nativeBuildVerified ? "PASS" : "UNKNOWN",
  evidence: packageEvidence ? "Exact-commit UIA and Job Host binary hashes matched package evidence; packaged durable-recovery smoke passed."
    : "Native UIA and Job Host must be built, packaged and validated by scripts/package-windows.ps1." });

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  revision: (await commandResult("git", ["rev-parse", "HEAD"])).output.trim(),
  environment: { platform: process.platform, arch: process.arch, node: process.version, cpus: os.cpus().length, totalMemoryBytes: os.totalmem(), freeMemoryBytes: os.freemem() },
  hostLatency: "UNKNOWN",
  ...(() => {
    const scoped = assessAcceptance(results, { skipConcurrentApps: process.env.QNECTOR_SKIP_CONCURRENT_APP_TESTS === "1" });
    return { releaseEligible: scoped.releaseEligible, localValidationEligible: scoped.localValidationEligible,
      waiverPolicy: scoped.waivedGates.length ? "user-waived-external-apps" : "strict",
      waivedGates: scoped.waivedGates, gates: scoped.gates };
  })(),
};
const output = process.env.QNECTOR_ACCEPTANCE_REPORT ?? path.join(root, "fixtures/performance/task12-acceptance-report.json");
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
const exceptionReport = await writeAcceptanceExceptions(report, process.env.QNECTOR_QA_REPORT_DIR ?? path.join(root, "apps/desktop/release/qa-reports"));
console.log(JSON.stringify({ report: path.relative(root, output), releaseEligible: report.releaseEligible,
  localValidationEligible: report.localValidationEligible, waivedGates: report.waivedGates,
  exceptionReport: path.relative(root, exceptionReport), gates: report.gates }, null, 2));
if (results.some((result) => result.status === "FAIL")) process.exitCode = 1;

async function commandResult(file: string, args: string[]) {
  try { const { stdout, stderr } = await execFileAsync(file, args, { cwd: root, windowsHide: true, timeout: 30_000 }); return { code: 0, output: stdout + stderr }; }
  catch (error) { const e = error as Error & { code?: number; stdout?: string; stderr?: string }; return { code: typeof e.code === "number" ? e.code : 1, output: `${e.stdout ?? ""}${e.stderr ?? e.message}` }; }
}
