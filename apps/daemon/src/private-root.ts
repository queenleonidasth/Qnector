import { spawnSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync } from "node:fs";
import path from "node:path";

/** Protect the execution journal and bearer token BEFORE binding the IPC pipe.
 * This root is dedicated to Qnector; do not point it at an arbitrary folder. */
export function secureExecutionRoot(root: string): void {
  const resolved = path.resolve(root);
  mkdirSync(resolved, {recursive: true, mode: 0o700});
  const info = lstatSync(resolved);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("DAEMON_ROOT_UNSAFE");
  if (process.platform !== "win32") {
    chmodSync(resolved, 0o700);
    return;
  }
  const identity = spawnSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], {
    windowsHide: true, encoding: "utf8", timeout: 5_000,
  });
  const sid = /"(S-1-(?:\d+-)+\d+)"/.exec(identity.stdout ?? "")?.[1];
  if (identity.status !== 0 || !sid) throw new Error("DAEMON_ACL_IDENTITY_UNAVAILABLE");
  // Remove inherited access on the root AND its existing contents, then grant
  // only the current user, SYSTEM and local Administrators. Explicit grants
  // to other principals must be detected rather than silently trusted.
  const acl = spawnSync("icacls.exe", [resolved, "/inheritance:r", "/grant:r",
    `*${sid}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F", "/T"], {
    windowsHide: true, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024,
  });
  if (acl.status !== 0 || acl.error)
    throw new Error("DAEMON_ACL_HARDEN_FAILED");
  // icacls does not propagate an inheritance-only (OI)(CI) grant as an
  // effective ACE to existing files when /inheritance:r /T runs together.
  // Explicitly grant access to every existing child, then restore the root's
  // inheritable ACE for files created after startup. Otherwise daemon-token
  // becomes unreadable on restart even to its owner.
  const existing = spawnSync("icacls.exe", [resolved, "/grant:r", `*${sid}:F`,
    "*S-1-5-18:F", "*S-1-5-32-544:F", "/T"], {
    windowsHide: true, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024,
  });
  const future = spawnSync("icacls.exe", [resolved, "/grant:r", `*${sid}:(OI)(CI)F`,
    "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"], {
    windowsHide: true, encoding: "utf8", timeout: 5_000,
  });
  if (existing.status !== 0 || existing.error || future.status !== 0 || future.error)
    throw new Error("DAEMON_ACL_HARDEN_FAILED");
  const auditScript = [
    "$ErrorActionPreference='Stop'",
    "$allowed=@($env:QNECTOR_OWNER_SID,'S-1-5-18','S-1-5-32-544')",
    "$items=@(Get-Item -LiteralPath $env:QNECTOR_SECURE_ROOT -Force)",
    "$items+=@(Get-ChildItem -LiteralPath $env:QNECTOR_SECURE_ROOT -Force -Recurse)",
    "foreach($item in $items){",
    // A worker atomically renames its short-lived *.tmp files while the
    // daemon restarts. The enumeration snapshot can include a vanished path.
    // Skip ONLY genuinely disappeared children; a missing root or an ACL
    // error on a path that still exists remains a startup failure.
    " try { $rules=Get-Acl -LiteralPath $item.FullName -ErrorAction Stop }",
    " catch {",
    "  if($item.FullName -eq $env:QNECTOR_SECURE_ROOT -or (Test-Path -LiteralPath $item.FullName)) { throw }",
    "  continue",
    " }",
    " if($item.FullName -eq $env:QNECTOR_SECURE_ROOT -and -not $rules.AreAccessRulesProtected){throw 'UNPROTECTED_ACL'}",
    " foreach($entry in $rules.Access){",
    "  $identity=$entry.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value",
    "  if($identity -notin $allowed -or $entry.AccessControlType -ne 'Allow'){throw 'UNEXPECTED_ACL'}",
    " }",
    "}",
    "Write-Output 'ACL_OK'",
  ].join("\n");
  const audit = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", auditScript], {
    windowsHide: true, encoding: "utf8", timeout: 30_000,
    env: {...process.env, QNECTOR_OWNER_SID: sid, QNECTOR_SECURE_ROOT: resolved},
  });
  if (audit.status !== 0 || audit.error || !audit.stdout?.includes("ACL_OK"))
    throw new Error(`DAEMON_ACL_AUDIT_FAILED: ${(audit.stderr || audit.stdout || audit.error?.message || "unknown").slice(0, 260)}`);
}
