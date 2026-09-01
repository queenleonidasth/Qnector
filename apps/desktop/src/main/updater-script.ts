import type { DesktopUpdateMode } from "../updater-types.js";

export interface WindowsUpdateScriptInput {
  mode: DesktopUpdateMode;
  processId: number;
  sourcePath: string;
  targetExecutable: string;
  logPath: string;
  readyPath: string;
}

export function buildWindowsUpdateScript(
  input: WindowsUpdateScriptInput,
): string {
  const source = psQuote(input.sourcePath);
  const target = psQuote(input.targetExecutable);
  const log = psQuote(input.logPath);
  const ready = psQuote(input.readyPath);

  const lines = [
    "$ErrorActionPreference = 'Stop'",
    `$processIdToWaitFor = ${input.processId}`,
    `$source = ${source}`,
    `$target = ${target}`,
    `$log = ${log}`,
    `$ready = ${ready}`,
    "function Write-UpdateLog([string]$message) {",
    "  try {",
    "    $timestamp = Get-Date -Format 'o'",
    '    Add-Content -LiteralPath $log -Value "[$timestamp] $message" -Encoding UTF8 -ErrorAction SilentlyContinue',
    "  } catch {}",
    "}",
    "function Wait-ForQnectorProcess([int]$id, [string]$label) {",
    "  if ($id -le 0 -or $id -eq $PID) { return }",
    '  Write-UpdateLog "Waiting for $label PID $id to exit"',
    "  try { Wait-Process -Id $id -ErrorAction SilentlyContinue } catch {}",
    '  Write-UpdateLog "$label PID $id has exited"',
    "}",
    "function Start-QnectorTarget {",
    "  $workingDirectory = Split-Path -Parent $target",
    "  for ($launchAttempt = 1; $launchAttempt -le 5; $launchAttempt++) {",
    "    try {",
    "      $launched = Start-Process -FilePath $target -WorkingDirectory $workingDirectory -PassThru",
    '      Write-UpdateLog "Launch attempt $launchAttempt started PID $($launched.Id)"',
    "      Start-Sleep -Milliseconds 1200",
    "      $stillRunning = Get-Process -Id $launched.Id -ErrorAction SilentlyContinue",
    "      if ($null -ne $stillRunning) {",
    "        Write-UpdateLog 'Updated Qnector process is still running after launch verification'",
    "        return",
    "      }",
    '      Write-UpdateLog "Launch attempt $launchAttempt exited too early"',
    "    } catch {",
    '      Write-UpdateLog "Launch attempt $launchAttempt failed: $($_.Exception.Message)"',
    "    }",
    "    Start-Sleep -Milliseconds 800",
    "  }",
    "  throw 'Qnector could not be relaunched after 5 attempts'",
    "}",
    "try {",
    `  Write-UpdateLog ${psQuote(`Starting ${input.mode} update`)}`,
    '  Write-UpdateLog "Source: $source"',
    '  Write-UpdateLog "Target: $target"',
    '  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Downloaded update is missing: $source" }',
    "  Set-Content -LiteralPath $ready -Value 'ready' -Encoding ASCII -Force",
    "  Write-UpdateLog 'Updater helper handshake ready'",
    "  Wait-ForQnectorProcess $processIdToWaitFor 'Electron'",
    "  Start-Sleep -Milliseconds 350",
  ];

  if (input.mode === "portable") {
    lines.push(
      "  $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash",
      "  $replaced = $false",
      "  for ($attempt = 1; $attempt -le 60; $attempt++) {",
      "    try {",
      "      Copy-Item -LiteralPath $source -Destination $target -Force",
      "      $replaced = $true",
      '      Write-UpdateLog "Portable executable replaced on attempt $attempt"',
      "      break",
      "    } catch {",
      '      Write-UpdateLog "Replace attempt $attempt failed: $($_.Exception.Message)"',
      "      if ($attempt -ge 60) { throw }",
      "      Start-Sleep -Milliseconds 500",
      "    }",
      "  }",
      "  if (-not $replaced) { throw 'Portable executable was not replaced' }",
      "  $targetHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash",
      '  if ($sourceHash -ne $targetHash) { throw "Updated executable SHA-256 mismatch: expected $sourceHash, got $targetHash" }',
      '  Write-UpdateLog "SHA-256 verified after replacement: $targetHash"',
      "  Start-Sleep -Milliseconds 700",
      "  Start-QnectorTarget",
    );
  } else {
    lines.push(
      "  Write-UpdateLog 'Launching NSIS installer'",
      "  $installer = Start-Process -FilePath $source -ArgumentList '/S' -Wait -PassThru",
      '  if ($installer.ExitCode -ne 0) { throw "Installer exited with code $($installer.ExitCode)" }',
      "  Start-Sleep -Milliseconds 700",
      '  if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw "Installed executable is missing: $target" }',
      "  Start-QnectorTarget",
    );
  }

  lines.push(
    "  Remove-Item -LiteralPath $source -Force -ErrorAction SilentlyContinue",
    "  Remove-Item -LiteralPath $ready -Force -ErrorAction SilentlyContinue",
    "  Write-UpdateLog 'Update completed successfully'",
    "  Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue",
    "  exit 0",
    "} catch {",
    '  Write-UpdateLog "UPDATE FAILED: $($_.Exception.Message)"',
    "  Write-UpdateLog $_.ScriptStackTrace",
    "  if (Test-Path -LiteralPath $target -PathType Leaf) {",
    "    try {",
    "      Start-QnectorTarget",
    "      Write-UpdateLog 'Recovery launch of the existing Qnector executable succeeded'",
    "    } catch {",
    '      Write-UpdateLog "Recovery launch failed: $($_.Exception.Message)"',
    "    }",
    "  }",
    "  exit 1",
    "}",
  );

  return `${lines.join("\r\n")}\r\n`;
}

function psQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
