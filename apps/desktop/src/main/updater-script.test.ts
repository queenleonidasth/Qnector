import { describe, expect, it } from "vitest";
import { buildWindowsUpdateScript } from "./updater-script.js";

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
    });

    expect(script).toContain("-ArgumentList '/S' -Wait -PassThru");
    expect(script).toContain("Installer exited with code");
    expect(script).toContain("Start-QnectorTarget");
  });
});
