import { describe, expect, it } from "vitest";
import { buildWindowsUpdateScript } from "./updater-script.js";

describe("Windows updater apply script", () => {
  it("waits for both Electron and the portable launcher before replacing the executable", () => {
    const script = buildWindowsUpdateScript({
      mode: "portable",
      processId: 1234,
      launcherProcessId: 5678,
      sourcePath: "C:\\Temp\\Qnector-0.3.3-win-x64-portable.exe",
      targetExecutable: "C:\\Apps\\Qnector-portable.exe",
      logPath: "C:\\Temp\\apply-update.log",
    });

    expect(script).toContain("$processIdToWaitFor = 1234");
    expect(script).toContain("$launcherProcessIdToWaitFor = 5678");
    expect(script).toContain(
      "Wait-ForQnectorProcess $launcherProcessIdToWaitFor 'Portable launcher'",
    );
    expect(script).toContain("for ($attempt = 1; $attempt -le 40; $attempt++)");
    expect(script).toContain("Start-Sleep -Milliseconds 500");
  });

  it("verifies the copied portable executable and keeps diagnostic recovery behavior", () => {
    const script = buildWindowsUpdateScript({
      mode: "portable",
      processId: 1,
      launcherProcessId: 2,
      sourcePath: "C:\\Temp\\new.exe",
      targetExecutable: "C:\\Apps\\Qnector.exe",
      logPath: "C:\\Temp\\apply-update.log",
    });

    expect(script).toContain(
      "Get-FileHash -LiteralPath $source -Algorithm SHA256",
    );
    expect(script).toContain(
      "Get-FileHash -LiteralPath $target -Algorithm SHA256",
    );
    expect(script).toContain("UPDATE FAILED:");
    expect(script).toContain(
      "Recovery launch of the existing Qnector executable succeeded",
    );
    expect(script).toContain("apply-update.log");
  });

  it("waits for the NSIS installer and checks its exit code for installed builds", () => {
    const script = buildWindowsUpdateScript({
      mode: "installed",
      processId: 999,
      launcherProcessId: 888,
      sourcePath: "C:\\Temp\\setup.exe",
      targetExecutable: "C:\\Program Files\\Qnector\\Qnector.exe",
      logPath: "C:\\Temp\\apply-update.log",
    });

    expect(script).toContain("$launcherProcessIdToWaitFor = 0");
    expect(script).toContain("-ArgumentList '/S' -Wait -PassThru");
    expect(script).toContain("Installer exited with code");
  });
});
