import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { ToolAttachment } from "@qnector/shared";

const execFileAsync = promisify(execFile);

export interface PlatformCapabilities {
  clipboardText: boolean;
  toast: boolean;
  screenCapture: boolean;
  windowList: boolean;
  windowFocus: boolean;
  provider: "electron" | "windows" | "unsupported";
}

export interface ClipboardPayload {
  type: "text";
  text: string;
  sizeBytes: number;
  truncated: boolean;
}

export interface ClipboardWriteInput {
  text: string;
  html?: string;
}

export interface ToastInput {
  title: string;
  body: string;
  silent?: boolean;
}

export interface ScreenCaptureInput {
  source?: "primary" | "screen" | "window";
  sourceId?: string;
  format?: "png" | "jpeg";
  maxWidth?: number;
}

export interface ImagePreviewInput {
  path: string;
  format?: "png" | "jpeg";
  maxWidth?: number;
}

export interface WindowInfo {
  id: string;
  captureSourceId?: string;
  title: string;
  processName: string;
  pid: number;
  bounds?: { x: number; y: number; width: number; height: number };
  minimized?: boolean;
}

export interface PlatformServices {
  capabilities(): PlatformCapabilities;
  readClipboard(): Promise<ClipboardPayload>;
  writeClipboard(input: ClipboardWriteInput): Promise<void>;
  showToast(input: ToastInput): Promise<void>;
  captureScreen(input: ScreenCaptureInput): Promise<ToolAttachment>;
  previewImage?(input: ImagePreviewInput): Promise<ToolAttachment>;
  listWindows(): Promise<WindowInfo[]>;
  focusWindow(id: string): Promise<void>;
}

export class NodePlatformServices implements PlatformServices {
  public constructor(private readonly powershellPath?: string) {}

  public capabilities(): PlatformCapabilities {
    const windows = process.platform === "win32";
    const clipboardText = windows || process.platform === "darwin";
    return {
      clipboardText,
      toast: false,
      screenCapture: false,
      windowList: windows,
      windowFocus: windows,
      provider: windows ? "windows" : "unsupported",
    };
  }

  public async readClipboard(): Promise<ClipboardPayload> {
    const maxChars = 1_000_000;
    let text: string;
    if (process.platform === "win32") {
      text = (await this.runPowerShell("Get-Clipboard -Raw -ErrorAction Stop"))
        .stdout;
    } else if (process.platform === "darwin") {
      text = (await execFileAsync("pbpaste", [], { maxBuffer: maxChars * 2 }))
        .stdout;
    } else {
      throw unsupported("clipboardText");
    }
    const trimmed = text.length > maxChars ? text.slice(0, maxChars) : text;
    return {
      type: "text",
      text: trimmed,
      sizeBytes: Buffer.byteLength(text, "utf8"),
      truncated: trimmed.length < text.length,
    };
  }

  public async writeClipboard(input: ClipboardWriteInput): Promise<void> {
    if (input.text.length > 1_000_000)
      throw new Error("CLIPBOARD_TOO_LARGE: text exceeds 1000000 characters");
    if (process.platform === "win32") {
      const encoded = Buffer.from(input.text, "utf8").toString("base64");
      await this.runPowerShell(
        `$value = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); Set-Clipboard -Value $value`,
      );
      return;
    }
    if (process.platform === "darwin") {
      await new Promise<void>((resolve, reject) => {
        const child = spawn("pbcopy", [], {
          windowsHide: true,
          stdio: ["pipe", "ignore", "ignore"],
        });
        child.once("error", reject);
        child.once("close", (code: number) =>
          code === 0
            ? resolve()
            : reject(new Error(`CLIPBOARD_WRITE_FAILED: exit ${code}`)),
        );
        child.stdin?.end(input.text, "utf8");
      });
      return;
    }
    throw unsupported("clipboardText");
  }

  public async showToast(_input: ToastInput): Promise<void> {
    throw unsupported("toast");
  }

  public async captureScreen(
    _input: ScreenCaptureInput,
  ): Promise<ToolAttachment> {
    throw unsupported("screenCapture");
  }

  public async previewImage(input: ImagePreviewInput): Promise<ToolAttachment> {
    if (process.platform !== "win32") throw unsupported("imagePreview");
    const target = input.path.replace(/'/g, "''");
    const maxWidth = Math.max(
      320,
      Math.min(4_096, Math.floor(input.maxWidth ?? 2_048)),
    );
    const format = input.format ?? "jpeg";
    const imageFormat =
      format === "png"
        ? "[System.Drawing.Imaging.ImageFormat]::Png"
        : "[System.Drawing.Imaging.ImageFormat]::Jpeg";
    const script = `Add-Type -AssemblyName System.Drawing; $img=[System.Drawing.Image]::FromFile('${target}'); try { $w=$img.Width; $h=$img.Height; if ($w -gt ${maxWidth}) { $h=[Math]::Max(1,[int][Math]::Round($h*${maxWidth}/$w)); $w=${maxWidth} }; $bmp=New-Object System.Drawing.Bitmap($w,$h); try { $g=[System.Drawing.Graphics]::FromImage($bmp); try { $g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic; $g.DrawImage($img,0,0,$w,$h) } finally { $g.Dispose() }; $ms=New-Object System.IO.MemoryStream; try { $bmp.Save($ms,${imageFormat}); [PSCustomObject]@{ width=$w; height=$h; data=[Convert]::ToBase64String($ms.ToArray()) } | ConvertTo-Json -Compress } finally { $ms.Dispose() } } finally { $bmp.Dispose() } } finally { $img.Dispose() }`;
    const raw = (await this.runPowerShell(script, 16_000_000)).stdout.trim();
    const parsed = JSON.parse(raw) as {
      width: number;
      height: number;
      data: string;
    };
    const bytes = Buffer.from(parsed.data, "base64");
    return {
      type: "image",
      mimeType: format === "png" ? "image/png" : "image/jpeg",
      dataBase64: parsed.data,
      width: parsed.width,
      height: parsed.height,
      sizeBytes: bytes.length,
    };
  }

  public async listWindows(): Promise<WindowInfo[]> {
    if (process.platform !== "win32") throw unsupported("windowList");
    const script =
      'Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { $r=$_.MainWindowHandle; [PSCustomObject]@{ Id="window_$($_.Id)"; Title=$_.MainWindowTitle; ProcessName=$_.ProcessName; Pid=$_.Id } } | ConvertTo-Json -Compress';
    const raw = (await this.runPowerShell(script)).stdout.trim();
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    return entries.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const value = entry as Record<string, unknown>;
      const pid = Number(value.Pid);
      if (!Number.isInteger(pid)) return [];
      return [
        {
          id: String(value.Id ?? `window_${pid}`),
          title: String(value.Title ?? ""),
          processName: String(value.ProcessName ?? ""),
          pid,
        },
      ];
    });
  }

  public async focusWindow(id: string): Promise<void> {
    if (process.platform !== "win32") throw unsupported("windowFocus");
    const match = /^window_(\d+)$/.exec(id);
    if (!match) throw new Error(`INVALID_INPUT: unknown window id '${id}'`);
    const pid = Number(match[1]);
    const script = `Add-Type @'\nusing System;\nusing System.Runtime.InteropServices;\npublic static class QnectorWindow { [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow); }\n'@; $p=Get-Process -Id ${pid} -ErrorAction Stop; if ($p.MainWindowHandle -eq 0) { throw 'WINDOW_NOT_FOCUSABLE' }; [QnectorWindow]::ShowWindow($p.MainWindowHandle, 9) | Out-Null; if (-not [QnectorWindow]::SetForegroundWindow($p.MainWindowHandle)) { throw 'WINDOW_FOCUS_DENIED' }`;
    await this.runPowerShell(script);
  }

  private async runPowerShell(
    script: string,
    maxBuffer = 4_000_000,
  ): Promise<{ stdout: string; stderr: string }> {
    const executable =
      this.powershellPath ??
      process.env.QNECTOR_POWERSHELL_PATH ??
      "powershell.exe";
    try {
      return await execFileAsync(
        executable,
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
        { windowsHide: true, maxBuffer },
      );
    } catch (error: unknown) {
      const candidate = error as { stderr?: string; message?: string };
      const details = (
        candidate.stderr ??
        candidate.message ??
        "PowerShell command failed"
      ).trim();
      if (details.includes("WINDOW_FOCUS_DENIED"))
        throw new Error("WINDOW_FOCUS_DENIED: Windows denied foreground focus");
      if (details.includes("WINDOW_NOT_FOCUSABLE"))
        throw new Error("WINDOW_NOT_FOCUSABLE: window has no main handle");
      throw new Error(`PLATFORM_COMMAND_FAILED: ${details}`);
    }
  }
}

export class UnsupportedPlatformServices implements PlatformServices {
  public capabilities(): PlatformCapabilities {
    return {
      clipboardText: false,
      toast: false,
      screenCapture: false,
      windowList: false,
      windowFocus: false,
      provider: "unsupported",
    };
  }

  public readClipboard(): Promise<ClipboardPayload> {
    return Promise.reject(unsupported("clipboardText"));
  }
  public writeClipboard(_input: ClipboardWriteInput): Promise<void> {
    return Promise.reject(unsupported("clipboardText"));
  }
  public showToast(_input: ToastInput): Promise<void> {
    return Promise.reject(unsupported("toast"));
  }
  public captureScreen(_input: ScreenCaptureInput): Promise<ToolAttachment> {
    return Promise.reject(unsupported("screenCapture"));
  }
  public listWindows(): Promise<WindowInfo[]> {
    return Promise.reject(unsupported("windowList"));
  }
  public focusWindow(_id: string): Promise<void> {
    return Promise.reject(unsupported("windowFocus"));
  }
}

export function createDefaultPlatformServices(): PlatformServices {
  return new NodePlatformServices();
}

function unsupported(capability: string): Error {
  return new Error(
    `UNSUPPORTED_CAPABILITY: ${capability} is not available in this runtime`,
  );
}
