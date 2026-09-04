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
    expect(script).toContain("Installed target version verified at $target");
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
    });

    expect(WINDOWS_UPDATER_BOOTSTRAP_DETACHED).toBe(false);
    expect(script).toContain("Start-Process -FilePath $powershell");
    expect(script).toContain("-EncodedCommand");
    const encoded = /\$encodedCommand = '([^']+)'/.exec(script)?.[1];
    expect(encoded).toBeTruthy();
    expect(Buffer.from(encoded!, "base64").toString("utf16le")).toBe(
      "& 'C:\\Users\\Queen''s PC\\apply update.ps1'",
    );
  });
});
