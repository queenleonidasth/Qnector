import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";

export interface PowerShellWorkerResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

interface WorkerResponse {
  id: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface PendingRequest {
  id: string;
  resolve: (value: WorkerResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const RESULT_PREFIX = "__QNECTOR_RESULT__";
const workerCache = new Map<string, PowerShellWorker>();

export function canUsePersistentPowerShell(
  command: string,
  env?: Record<string, string>,
): boolean {
  if (process.platform !== "win32") return false;
  if (process.env.QNECTOR_POWERSHELL_WORKER === "0") return false;
  if (env && Object.keys(env).length > 0) return false;
  // These constructs can intentionally terminate or take over the host process.
  // Keep them on the isolated one-shot path.
  if (/\b(?:exit|read-host|start-transcript|stop-transcript)\b/i.test(command))
    return false;
  if (/\[console\]::(?:read|readline|readkey)/i.test(command)) return false;
  return true;
}

export async function runPersistentPowerShell(
  executable: string,
  input: { command: string; cwd: string; timeoutMs: number },
): Promise<PowerShellWorkerResult> {
  const key = executable.toLowerCase();
  let worker = workerCache.get(key);
  if (!worker) {
    worker = new PowerShellWorker(executable);
    workerCache.set(key, worker);
  }
  return worker.run(input);
}

export async function shutdownPowerShellWorkers(): Promise<void> {
  const workers = [...workerCache.values()];
  workerCache.clear();
  await Promise.all(workers.map((worker) => worker.stop()));
}

class PowerShellWorker {
  private child?: ChildProcessWithoutNullStreams;
  private stdoutBuffer = "";
  private stderrTail = "";
  private pending?: PendingRequest;
  private queue: Promise<void> = Promise.resolve();

  public constructor(private readonly executable: string) {}

  public run(input: {
    command: string;
    cwd: string;
    timeoutMs: number;
  }): Promise<PowerShellWorkerResult> {
    const task = this.queue.then(() => this.execute(input));
    this.queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  public async stop(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (!child || child.exitCode !== null) return;
    child.stdin.end();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // Best effort during shutdown.
        }
        resolve();
      }, 500);
      child.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private async execute(input: {
    command: string;
    cwd: string;
    timeoutMs: number;
  }): Promise<PowerShellWorkerResult> {
    const started = Date.now();
    const child = this.ensureChild();
    const id = randomUUID();
    const payload = Buffer.from(
      JSON.stringify({ id, command: input.command, cwd: input.cwd }),
      "utf8",
    ).toString("base64");
    try {
      const response = await new Promise<WorkerResponse>((resolve, reject) => {
        const timer = setTimeout(
          () => {
            if (this.pending?.id !== id) return;
            this.pending = undefined;
            reject(new Error("POWERSHELL_WORKER_TIMEOUT"));
            void this.resetChild();
          },
          Math.max(1, input.timeoutMs),
        );
        this.pending = { id, resolve, reject, timer };
        child.stdin.write(`${payload}\n`, "utf8", (error) => {
          if (!error) return;
          if (this.pending?.id === id) {
            clearTimeout(this.pending.timer);
            this.pending = undefined;
          }
          reject(error);
          void this.resetChild();
        });
      });
      return {
        exitCode: response.exitCode,
        signal: null,
        stdout: response.stdout,
        stderr: response.stderr,
        durationMs: Date.now() - started,
      };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "POWERSHELL_WORKER_TIMEOUT"
      ) {
        return {
          exitCode: null,
          signal: "SIGTERM",
          stdout: "",
          stderr: "",
          durationMs: Date.now() - started,
        };
      }
      throw error;
    }
  }

  private ensureChild(): ChildProcessWithoutNullStreams {
    if (this.child && this.child.exitCode === null) return this.child;
    const encodedScript = Buffer.from(WORKER_SCRIPT, "utf16le").toString(
      "base64",
    );
    const child = spawn(
      this.executable,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encodedScript,
      ],
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.child = child;
    this.stdoutBuffer = "";
    this.stderrTail = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.consumeStdout(chunk));
    child.stderr.on("data", (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-8_000);
    });
    child.once("error", (error) => this.failPending(error));
    child.once("close", (code) => {
      if (this.child === child) this.child = undefined;
      this.failPending(
        new Error(
          `POWERSHELL_WORKER_EXITED: ${code ?? "unknown"}${
            this.stderrTail.trim() ? `: ${this.stderrTail.trim()}` : ""
          }`,
        ),
      );
    });
    return child;
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    while (true) {
      const newline = this.stdoutBuffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.stdoutBuffer.slice(0, newline).replace(/\r$/, "");
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line.startsWith(RESULT_PREFIX)) continue;
      try {
        const decoded = Buffer.from(
          line.slice(RESULT_PREFIX.length),
          "base64",
        ).toString("utf8");
        const response = JSON.parse(decoded) as WorkerResponse;
        if (!this.pending || response.id !== this.pending.id) continue;
        const pending = this.pending;
        this.pending = undefined;
        clearTimeout(pending.timer);
        pending.resolve(response);
      } catch (error) {
        this.failPending(
          new Error(
            `POWERSHELL_WORKER_PROTOCOL: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
      }
    }
  }

  private failPending(error: Error): void {
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = undefined;
    clearTimeout(pending.timer);
    pending.reject(error);
  }

  private async resetChild(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (!child || child.exitCode !== null) return;
    try {
      if (process.platform === "win32" && child.pid) {
        spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
      } else child.kill("SIGKILL");
    } catch {
      // The worker is disposable; the next command will start a new one.
    }
  }
}

const WORKER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $outFile = [IO.Path]::GetTempFileName()
  $errFile = [IO.Path]::GetTempFileName()
  $request = $null
  try {
    $json = $utf8.GetString([Convert]::FromBase64String($line))
    $request = $json | ConvertFrom-Json
    $exitCode = 0
    Push-Location -LiteralPath ([string]$request.cwd)
    try {
      $global:LASTEXITCODE = 0
      $script = [ScriptBlock]::Create([string]$request.command)
      & $script 3>&1 4>&1 5>&1 6>&1 1> $outFile 2> $errFile
      if ($null -ne $LASTEXITCODE) { $exitCode = [int]$LASTEXITCODE }
    } catch {
      ($_ | Out-String) | Out-File -LiteralPath $errFile -Append -Encoding utf8
      $exitCode = 1
    } finally {
      Pop-Location
    }
    $stdout = if (Test-Path -LiteralPath $outFile) { [IO.File]::ReadAllText($outFile) } else { '' }
    $stderr = if (Test-Path -LiteralPath $errFile) { [IO.File]::ReadAllText($errFile) } else { '' }
    $response = @{
      id = [string]$request.id
      exitCode = $exitCode
      stdout = $stdout
      stderr = $stderr
    } | ConvertTo-Json -Compress
    $encoded = [Convert]::ToBase64String($utf8.GetBytes($response))
    [Console]::Out.WriteLine('${RESULT_PREFIX}' + $encoded)
    [Console]::Out.Flush()
  } catch {
    $id = if ($null -ne $request) { [string]$request.id } else { '' }
    $response = @{
      id = $id
      exitCode = 1
      stdout = ''
      stderr = ($_ | Out-String)
    } | ConvertTo-Json -Compress
    $encoded = [Convert]::ToBase64String($utf8.GetBytes($response))
    [Console]::Out.WriteLine('${RESULT_PREFIX}' + $encoded)
    [Console]::Out.Flush()
  } finally {
    Remove-Item -LiteralPath $outFile,$errFile -Force -ErrorAction SilentlyContinue
  }
}
`;
