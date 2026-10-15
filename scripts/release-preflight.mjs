import { createHash } from "node:crypto";
import { existsSync, readFileSync, statfsSync } from "node:fs";
import { execFile } from "node:child_process";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nativeInputs = ["packages/execution/job-host/Qnector.JobHost.csproj", "packages/execution/job-host/Program.cs", "tools/uia-helper/Qnector.UiaHelper.csproj"];
const secretAvailability = ["GH_TOKEN", "GITHUB_TOKEN", "QNECTOR_SIGNING_CERTIFICATE"];
const hash = (value) => createHash("sha256").update(value).digest("hex");
function hasGitHubCredential(cwd = root) {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return true;
  try {
    const result = spawnSync("git", ["credential", "fill"], { cwd, input: "protocol=https\nhost=github.com\n\n", encoding: "utf8", windowsHide: true, timeout: 5_000 });
    return result.status === 0 && /^password=.+$/m.test(result.stdout ?? "");
  } catch { return false; }
}

async function command(file, args, cwd = root) {
  try { const { stdout } = await execFileAsync(file, args, { cwd, windowsHide: true, timeout: 15_000 }); return { ok: true, value: stdout.trim() }; }
  catch (error) { return { ok: false, value: error?.code === "ENOENT" ? "missing" : "unavailable" }; }
}

export async function collectReleaseInputs(options = {}) {
  const projectRoot = options.root ?? root;
  const scopedCommand = (file, args) => command(file, args, projectRoot);
  const [revision, status, nodeVersion, pnpmVersion, dotnetVersion] = await Promise.all([
    scopedCommand("git", ["rev-parse", "HEAD"]), scopedCommand("git", ["status", "--porcelain=v1", "--untracked-files=all"]),
    scopedCommand(process.execPath, ["--version"]), scopedCommand(process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "pnpm", process.platform === "win32" ? ["/d", "/s", "/c", "pnpm.cmd --version"] : ["--version"]), scopedCommand("dotnet", ["--version"]),
  ]);
  const lockfile = path.join(projectRoot, "pnpm-lock.yaml");
  const native = nativeInputs.map((name) => {
    const file = path.join(projectRoot, name);
    return { path: name, present: existsSync(file), sha256: existsSync(file) ? hash(readFileSync(file)) : null };
  });
  let freeBytes = null;
  try { freeBytes = statfsSync(projectRoot).bavail * statfsSync(projectRoot).bsize; } catch { /* disk check reports unavailable */ }
  const inputs = {
    revision: revision.ok ? revision.value : null,
    dirtyState: status.ok ? (status.value ? hash(status.value) : "clean") : "unavailable",
    lockfileSha256: existsSync(lockfile) ? hash(readFileSync(lockfile)) : null,
    platform: `${process.platform}-${process.arch}-${os.release()}`,
    toolchain: { node: nodeVersion.value, pnpm: pnpmVersion.value, dotnet: dotnetVersion.value },
    native,
    credentialAvailability: Object.fromEntries(secretAvailability.map((key) => [key, Boolean(process.env[key])])),
    freeBytes,
  };
  const fingerprint = hash(JSON.stringify(inputs));
  const checks = [
    { name: "git", ok: revision.ok && status.ok }, { name: "lockfile", ok: Boolean(inputs.lockfileSha256) },
    { name: "node22+", ok: /^v(2[2-9]|[3-9]\d)\./.test(nodeVersion.value) },
    { name: "pnpm", ok: pnpmVersion.ok && pnpmVersion.value === "10.15.0" },
    { name: "dotnet", ok: dotnetVersion.ok },
    { name: "disk", ok: freeBytes !== null && freeBytes >= (options.minimumFreeBytes ?? 2 * 1024 ** 3) },
    { name: "native-inputs", ok: native.every((item) => item.present) },
    { name: "signing-credential-available", ok: Boolean(process.env.QNECTOR_SIGNING_CERTIFICATE), required: false },
  ];
  const publishMode = options.requirePublishingCredentials ?? false;
  checks.push({ name: "github-credential-available", ok: hasGitHubCredential(projectRoot), required: publishMode });
  return { inputs, fingerprint, checks, ready: checks.every((item) => item.ok || item.required === false) };
}

/** Reuse is permitted only for a complete artifact whose bytes match the immutable fingerprint. */
export function verifyCachedArtifact({ fingerprint, artifact, expectedFingerprint, expectedSha256 }) {
  if (!fingerprint || fingerprint !== expectedFingerprint || !artifact || !expectedSha256) return false;
  try { return hash(readFileSync(artifact)) === expectedSha256; } catch { return false; }
}

export function publishOutcomeAction(outcome) {
  if (outcome === "success") return "complete";
  if (outcome === "definite-failure") return "repair-and-retry-after-preflight";
  return "stop-and-inspect-remote-state";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await collectReleaseInputs({ requirePublishingCredentials: process.argv.includes("--publish") });
  console.log(JSON.stringify({ ...result, inputs: { ...result.inputs, credentialAvailability: result.inputs.credentialAvailability } }, null, 2));
  if (!result.ready) process.exitCode = 1;
}
