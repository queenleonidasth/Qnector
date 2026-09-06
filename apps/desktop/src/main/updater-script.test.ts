import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildWindowsUpdateScript,
  buildWindowsUpdaterBootstrapScript,
  WINDOWS_UPDATER_BOOTSTRAP_DETACHED,
} from "./updater-script.js";

const common = {
  processId: 1234,
  sourcePath: "C:\\Temp\\Qnector-update.exe",
  targetExecutable: "C:\\Apps\\Qnector-portable.exe",
  logPath: "C:\\Temp\\apply-update.log",
  readyPath: "C:\\Temp\\apply-update.ready",
};

describe("Windows updater apply script", () => {
  it("handshakes before the app quits and waits only for the Electron process", () => {
    const script = buildWindowsUpdateScript({
      ...common,
      mode: "portable",
    });

    expect(script).toContain("$processIdToWaitFor = 1234");
    expect(script).toContain(
      "Set-Content -LiteralPath $ready -Value 'ready' -Encoding ASCII -Force",
    );
    expect(script).toContain("Updater helper handshake ready");
    expect(script).toContain(
      "Wait-ForQnectorProcess $processIdToWaitFor 'Electron'",
    );
    expect(script).not.toContain("Portable launcher");
    expect(script).toContain("for ($attempt = 1; $attempt -le 60; $attempt++)");
  });

  it("verifies replacement and verifies a relaunched Qnector stays alive", () => {
    const script = buildWindowsUpdateScript({
      ...common,
      mode: "portable",
    });

    expect(script).toContain(
      "Get-FileHash -LiteralPath $source -Algorithm SHA256",
    );
    expect(script).toContain(
      "Get-FileHash -LiteralPath $target -Algorithm SHA256",
    );
    expect(script).toContain("Start-QnectorTarget");
    expect(script).toContain("$launchAttempt -le 5");
    expect(script).toContain("-WorkingDirectory $workingDirectory -PassThru");
    expect(script).toContain("Updated Qnector process is still running");
    expect(script).toContain("UPDATE FAILED:");
    expect(script).toContain(
      "Recovery launch of the existing Qnector executable succeeded",
    );
    expectPowerShellParses(script);
  });

  it("waits for the NSIS installer and checks its exit code for installed builds", () => {
    const script = buildWindowsUpdateScript({
      ...common,
      mode: "installed",
      sourcePath: "C:\\Temp\\setup.exe",
      targetExecutable: "C:\\Program Files\\Qnector\\Qnector.exe",
      expectedVersion: "0.4.7",
    });

    expect(script).toContain("$installScope = '/allusers'");
    expect(script).toContain(
      "-ArgumentList @('/S', $installScope) -Wait -PassThru",
    );
    expect(script).toContain("Installer exited with code");
    expect(script).toContain("$expectedVersion = '0.4.7'");
    expect(script).toContain("Installed target version mismatch");
    expect(script).toContain("Installed target version verified at ${target}:");
    expectPowerShellParses(script);
    expect(script).toContain("Start-QnectorTarget");
  });

  it("keeps per-user installed updates in the current-user scope", () => {
    const script = buildWindowsUpdateScript({
      ...common,
      mode: "installed",
      sourcePath: "C:\\Temp\\setup.exe",
      targetExecutable:
        "C:\\Users\\QUEEN\\AppData\\Local\\Programs\\Qnector\\Qnector.exe",
      expectedVersion: "0.4.7",
    });

    expect(script).toContain("$installScope = '/currentuser'");
  });
});

describe("Windows updater bootstrap", () => {
  it("keeps Node non-detached and launches the independent helper with encoded PowerShell", () => {
    const applyScriptPath = "C:\\Users\\Queen's PC\\apply update.ps1";
    const script = buildWindowsUpdaterBootstrapScript({
      powershellPath:
        "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      applyScriptPath,
      logPath: "C:\\Temp\\bootstrap-update.log",
    });

    expect(WINDOWS_UPDATER_BOOTSTRAP_DETACHED).toBe(false);
    expect(script).toContain("Start-Process -FilePath $powershell");
    expect(script).toContain("-EncodedCommand");
    expect(script).toContain("-PassThru");
    expect(script).not.toContain("Wait-Process -Id $helper.Id");
    expect(script).not.toContain("-Wait -PassThru");
    expect(script).toContain("Bootstrap starting apply helper");
    expect(script).toContain("Apply helper started PID");
    const encoded = /\$encodedCommand = '([^']+)'/.exec(script)?.[1];
    expect(encoded).toBeTruthy();
    expect(Buffer.from(encoded!, "base64").toString("utf16le")).toBe(
      "& 'C:\\Users\\Queen''s PC\\apply update.ps1'",
    );
    expectPowerShellParses(script);
  });

  it("executes the bootstrap and observes the independent apply helper exit", () => {
    if (process.platform !== "win32") return;
    const root = mkdtempSync(path.join(os.tmpdir(), "qnector-bootstrap-e2e-"));
    try {
      const nested = path.join(root, "Queen's updater test");
      mkdirSync(nested, { recursive: true });
      const applyScriptPath = path.join(nested, "apply update.ps1");
      const bootstrapPath = path.join(root, "bootstrap.ps1");
      const markerPath = path.join(root, "helper.marker");
      const logPath = path.join(root, "bootstrap.log");
      const markerLiteral = markerPath.replaceAll("'", "''");
      writeFileSync(
        applyScriptPath,
        `\uFEFFSet-Content -LiteralPath '${markerLiteral}' -Value 'ok' -Encoding ASCII -Force\r\nexit 0\r\n`,
        "utf8",
      );
      const bootstrap = buildWindowsUpdaterBootstrapScript({
        powershellPath:
          "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        applyScriptPath,
        logPath,
      });
      writeFileSync(bootstrapPath, `\uFEFF${bootstrap}`, "utf8");

      const result = spawnSync(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          bootstrapPath,
        ],
        { encoding: "utf8", windowsHide: true, timeout: 10_000 },
      );
      expect(
        result.status,
        `${result.stderr}\n${result.stdout}`.trim() ||
          "Bootstrap execution failed",
      ).toBe(0);
      expect(waitForFileSync(markerPath, 5_000)).toBe(true);
      expect(readFileSync(logPath, "utf8")).toContain(
        "Apply helper started PID",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("waits only for the apply helper PID, not a relaunched descendant process", () => {
    if (process.platform !== "win32") return;
    const root = mkdtempSync(path.join(os.tmpdir(), "qnector-bootstrap-tree-"));
    let descendantPid = 0;
    try {
      const applyScriptPath = path.join(root, "apply.ps1");
      const bootstrapPath = path.join(root, "bootstrap.ps1");
      const childPidPath = path.join(root, "child.pid");
      const logPath = path.join(root, "bootstrap.log");
      const childPidLiteral = childPidPath.replaceAll("'", "''");
      writeFileSync(
        applyScriptPath,
        [
          "\uFEFF$child = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 8') -WindowStyle Hidden -PassThru",
          `Set-Content -LiteralPath '${childPidLiteral}' -Value $child.Id -Encoding ASCII -Force`,
          "exit 0",
          "",
        ].join("\r\n"),
        "utf8",
      );
      const bootstrap = buildWindowsUpdaterBootstrapScript({
        powershellPath:
          "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        applyScriptPath,
        logPath,
      });
      writeFileSync(bootstrapPath, `\uFEFF${bootstrap}`, "utf8");

      const startedAt = Date.now();
      const result = spawnSync(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          bootstrapPath,
        ],
        { encoding: "utf8", windowsHide: true, timeout: 6_000 },
      );
      const elapsedMs = Date.now() - startedAt;
      expect(
        result.status,
        `${result.stderr}\n${result.stdout}`.trim() ||
          "Bootstrap incorrectly waited for the descendant process",
      ).toBe(0);
      expect(elapsedMs).toBeLessThan(6_000);
      expect(waitForFileSync(childPidPath, 5_000)).toBe(true);
      descendantPid = Number(readFileSync(childPidPath, "utf8").trim());
      expect(descendantPid).toBeGreaterThan(0);
      expect(readFileSync(logPath, "utf8")).toContain(
        "Apply helper started PID",
      );
    } finally {
      if (descendantPid > 0) {
        spawnSync("taskkill.exe", ["/PID", String(descendantPid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
      }
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function waitForFileSync(file: string, timeoutMs: number): boolean {
  const deadline = Date.now() + timeoutMs;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  while (Date.now() < deadline) {
    if (existsSync(file)) return true;
    Atomics.wait(sleeper, 0, 0, 50);
  }
  return existsSync(file);
}

function expectPowerShellParses(script: string): void {
  if (process.platform !== "win32") return;
  const scriptBase64 = Buffer.from(script, "utf8").toString("base64");
  const command = [
    `$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${scriptBase64}'))`,
    "$tokens = $null",
    "$errors = $null",
    "[System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$tokens, [ref]$errors) | Out-Null",
    "if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Error $_.Message }; exit 1 }",
    "exit 0",
  ].join("; ");
  const encodedCommand = Buffer.from(command, "utf16le").toString("base64");
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      encodedCommand,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  expect(
    result.status,
    `${result.stderr}\n${result.stdout}`.trim() || "PowerShell parser failed",
  ).toBe(0);
}
