import { execFile, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface NativeProcessInfo {
  pid: number;
  parentPid: number | null;
  name: string;
  executablePath: string | null;
  commandLine: string | null;
  startedAt: string | null;
  cpuSeconds: number | null;
  workingSetBytes: number | null;
  fileVersion: string | null;
  productVersion: string | null;
}

export interface NativePortInfo {
  localAddress: string;
  localPort: number;
  remoteAddress: string | null;
  remotePort: number | null;
  state: string;
  pid: number;
  processName: string | null;
}

export interface NativeProcessListResult {
  processes: NativeProcessInfo[];
  total: number;
  truncated: boolean;
}

export interface NativePortListResult {
  ports: NativePortInfo[];
  total: number;
  truncated: boolean;
}

export class NativeProcessService {
  public constructor(private readonly powershellPath?: string) {}

  public async list(
    input: {
      query?: string;
      maxResults?: number;
    } = {},
  ): Promise<NativeProcessListResult> {
    const maxResults = clamp(input.maxResults ?? 100, 1, 500);
    if (process.platform === "win32") {
      const rows = await this.windowsProcesses();
      const query = input.query?.trim().toLowerCase();
      const filtered = query
        ? rows.filter((entry) =>
            [entry.name, entry.executablePath ?? "", entry.commandLine ?? ""]
              .join(" ")
              .toLowerCase()
              .includes(query),
          )
        : rows;
      return {
        processes: filtered.slice(0, maxResults),
        total: filtered.length,
        truncated: filtered.length > maxResults,
      };
    }
    const rows = await this.posixProcesses();
    const query = input.query?.trim().toLowerCase();
    const filtered = query
      ? rows.filter((entry) =>
          `${entry.name} ${entry.commandLine ?? ""}`
            .toLowerCase()
            .includes(query),
        )
      : rows;
    return {
      processes: filtered.slice(0, maxResults),
      total: filtered.length,
      truncated: filtered.length > maxResults,
    };
  }

  public async inspect(pid: number): Promise<NativeProcessInfo | null> {
    if (!Number.isInteger(pid) || pid <= 0)
      throw new Error("INVALID_INPUT: pid must be a positive integer");
    const result = await this.list({ maxResults: 500 });
    return result.processes.find((entry) => entry.pid === pid) ?? null;
  }

  public async ports(
    input: {
      pid?: number;
      maxResults?: number;
    } = {},
  ): Promise<NativePortListResult> {
    const maxResults = clamp(input.maxResults ?? 100, 1, 500);
    if (process.platform !== "win32")
      return this.posixPorts(input.pid, maxResults);
    const pidFilter =
      typeof input.pid === "number" &&
      Number.isInteger(input.pid) &&
      input.pid > 0
        ? `$items = $items | Where-Object { $_.OwningProcess -eq ${input.pid} };`
        : "";
    const script = [
      "$ErrorActionPreference='SilentlyContinue';",
      "$items = Get-NetTCPConnection | Where-Object { $_.State -eq 'Listen' -or $_.State -eq 'Established' };",
      pidFilter,
      "$result = foreach($item in $items){",
      "  $proc = Get-Process -Id $item.OwningProcess -ErrorAction SilentlyContinue;",
      "  [pscustomobject]@{ localAddress=$item.LocalAddress; localPort=[int]$item.LocalPort; remoteAddress=if($item.RemoteAddress -and $item.RemoteAddress -ne '0.0.0.0' -and $item.RemoteAddress -ne '::'){[string]$item.RemoteAddress}else{$null}; remotePort=if($item.RemotePort -gt 0){[int]$item.RemotePort}else{$null}; state=[string]$item.State; pid=[int]$item.OwningProcess; processName=if($proc){[string]$proc.ProcessName}else{$null} }",
      "};",
      "$result | Sort-Object localPort,pid | ConvertTo-Json -Compress -Depth 4",
    ].join(" ");
    const rows = normalizeArray(await this.runPowerShellJson(script)).map(
      (value) => normalizePort(value),
    );
    return {
      ports: rows.slice(0, maxResults),
      total: rows.length,
      truncated: rows.length > maxResults,
    };
  }

  private async windowsProcesses(): Promise<NativeProcessInfo[]> {
    const script = [
      "$ErrorActionPreference='SilentlyContinue';",
      "$items = Get-CimInstance Win32_Process;",
      "$result = foreach($item in $items){",
      "  $p = Get-Process -Id $item.ProcessId -ErrorAction SilentlyContinue;",
      "  $fileVersion=$null; $productVersion=$null; $startedAt=$null;",
      "  if($p){ try { $startedAt=$p.StartTime.ToUniversalTime().ToString('o') } catch {} }",
      "  if($item.ExecutablePath -and (Test-Path -LiteralPath $item.ExecutablePath)){ try { $vi=(Get-Item -LiteralPath $item.ExecutablePath).VersionInfo; $fileVersion=[string]$vi.FileVersion; $productVersion=[string]$vi.ProductVersion } catch {} }",
      "  [pscustomobject]@{ pid=[int]$item.ProcessId; parentPid=if($item.ParentProcessId){[int]$item.ParentProcessId}else{$null}; name=[string]$item.Name; executablePath=if($item.ExecutablePath){[string]$item.ExecutablePath}else{$null}; commandLine=if($item.CommandLine){[string]$item.CommandLine}else{$null}; startedAt=$startedAt; cpuSeconds=if($p){try{[double]$p.CPU}catch{$null}}else{$null}; workingSetBytes=if($p){try{[long]$p.WorkingSet64}catch{$null}}else{$null}; fileVersion=$fileVersion; productVersion=$productVersion }",
      "};",
      "$result | Sort-Object pid | ConvertTo-Json -Compress -Depth 4",
    ].join(" ");
    return normalizeArray(await this.runPowerShellJson(script)).map((value) =>
      normalizeProcess(value),
    );
  }

  private async posixProcesses(): Promise<NativeProcessInfo[]> {
    const { stdout } = await execFileAsync(
      "ps",
      ["-axo", "pid=,ppid=,comm=,etime=,rss=,args="],
      { maxBuffer: 4_000_000 },
    );
    return stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        const match = line
          .trim()
          .match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(.*)$/);
        if (!match) return [];
        return [
          {
            pid: Number(match[1]),
            parentPid: Number(match[2]) || null,
            name: path.basename(match[3]!),
            executablePath: null,
            commandLine: match[6] || null,
            startedAt: null,
            cpuSeconds: null,
            workingSetBytes: Number(match[5]) * 1024,
            fileVersion: null,
            productVersion: null,
          } satisfies NativeProcessInfo,
        ];
      });
  }

  private async posixPorts(
    pid: number | undefined,
    maxResults: number,
  ): Promise<NativePortListResult> {
    try {
      const { stdout } = await execFileAsync("lsof", ["-nP", "-iTCP"], {
        maxBuffer: 4_000_000,
      });
      const rows = stdout
        .split(/\r?\n/)
        .slice(1)
        .filter(Boolean)
        .flatMap((line) => {
          const parts = line.trim().split(/\s+/);
          const rowPid = Number(parts[1]);
          if (!Number.isInteger(rowPid) || (pid && rowPid !== pid)) return [];
          const endpoint = parts.at(-2) ?? parts.at(-1) ?? "";
          const match = endpoint.match(/([^:]+):(\d+)(?:->([^:]+):(\d+))?/);
          if (!match) return [];
          return [
            {
              localAddress: match[1] ?? "",
              localPort: Number(match[2]),
              remoteAddress: match[3] ?? null,
              remotePort: match[4] ? Number(match[4]) : null,
              state: parts.at(-1)?.replace(/[()]/g, "") ?? "UNKNOWN",
              pid: rowPid,
              processName: parts[0] ?? null,
            } satisfies NativePortInfo,
          ];
        });
      return {
        ports: rows.slice(0, maxResults),
        total: rows.length,
        truncated: rows.length > maxResults,
      };
    } catch {
      return { ports: [], total: 0, truncated: false };
    }
  }

  private async runPowerShellJson(script: string): Promise<unknown> {
    const executable = this.resolvePowerShell();
    const { stdout } = await execFileAsync(
      executable,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, maxBuffer: 12_000_000 },
    );
    const text = stdout.trim();
    return text ? JSON.parse(text) : [];
  }

  private resolvePowerShell(): string {
    const requested = this.powershellPath?.trim();
    if (requested && executableAvailable(requested)) return requested;
    if (process.platform !== "win32") return "pwsh";
    return executableAvailable("pwsh.exe") ? "pwsh.exe" : "powershell.exe";
  }
}

function executableAvailable(command: string): boolean {
  try {
    if (path.isAbsolute(command)) return existsSync(command);
    const lookup = process.platform === "win32" ? "where.exe" : "which";
    return (
      spawnSync(lookup, [command], {
        windowsHide: true,
        stdio: "ignore",
      }).status === 0
    );
  } catch {
    return false;
  }
}

function normalizeArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value))
    return value.filter(
      (entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === "object",
    );
  if (value && typeof value === "object")
    return [value as Record<string, unknown>];
  return [];
}

function normalizeProcess(value: Record<string, unknown>): NativeProcessInfo {
  return {
    pid: Number(value.pid),
    parentPid: finiteNumber(value.parentPid),
    name: String(value.name ?? ""),
    executablePath: nullableString(value.executablePath),
    commandLine: nullableString(value.commandLine),
    startedAt: nullableString(value.startedAt),
    cpuSeconds: finiteNumber(value.cpuSeconds),
    workingSetBytes: finiteNumber(value.workingSetBytes),
    fileVersion: nullableString(value.fileVersion),
    productVersion: nullableString(value.productVersion),
  };
}

function normalizePort(value: Record<string, unknown>): NativePortInfo {
  return {
    localAddress: String(value.localAddress ?? ""),
    localPort: Number(value.localPort),
    remoteAddress: nullableString(value.remoteAddress),
    remotePort: finiteNumber(value.remotePort),
    state: String(value.state ?? "UNKNOWN"),
    pid: Number(value.pid),
    processName: nullableString(value.processName),
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length ? value : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : value === null || value === undefined
      ? null
      : Number.isFinite(Number(value))
        ? Number(value)
        : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}
