import {
  BrowserWindow,
  ClipboardItem,
  clipboard,
  desktopCapturer,
  Notification,
  nativeImage,
  screen,
} from "electron";
import type {
  ClipboardPayload,
  ClipboardWriteInput,
  PlatformCapabilities,
  PlatformServices,
  ImagePreviewInput,
  ScreenCaptureInput,
  ToastInput,
  WindowInfo,
} from "@qnector/core";
import { NodePlatformServices } from "@qnector/core";
import type { ToolAttachment } from "@qnector/shared";

export class ElectronPlatformServices implements PlatformServices {
  private readonly windows = new NodePlatformServices();

  public capabilities(): PlatformCapabilities {
    const fallback = this.windows.capabilities();
    return {
      ...fallback,
      clipboardText: true,
      toast: Notification.isSupported(),
      screenCapture: true,
      windowList:
        fallback.windowList || BrowserWindow.getAllWindows().length > 0,
      windowFocus:
        fallback.windowFocus || BrowserWindow.getAllWindows().length > 0,
      provider: "electron",
    };
  }

  public async readClipboard(): Promise<ClipboardPayload> {
    const text = await clipboard.readText();
    const maxChars = 1_000_000;
    const value = text.slice(0, maxChars);
    return {
      type: "text",
      text: value,
      sizeBytes: Buffer.byteLength(text, "utf8"),
      truncated: value.length < text.length,
    };
  }

  public async writeClipboard(input: ClipboardWriteInput): Promise<void> {
    if (input.text.length > 1_000_000)
      throw new Error("CLIPBOARD_TOO_LARGE: text exceeds 1000000 characters");
    if (input.html !== undefined) {
      await clipboard.write([
        new ClipboardItem({
          "text/plain": input.text,
          "text/html": input.html,
        }),
      ]);
    } else await clipboard.writeText(input.text);
  }

  public async showToast(input: ToastInput): Promise<void> {
    if (!Notification.isSupported())
      throw new Error(
        "UNSUPPORTED_CAPABILITY: toast is not supported by this OS",
      );
    new Notification({
      title: input.title.slice(0, 160),
      body: input.body.slice(0, 2_000),
      silent: input.silent === true,
    }).show();
  }

  public async captureScreen(
    input: ScreenCaptureInput,
  ): Promise<ToolAttachment> {
    const maxWidth = clamp(input.maxWidth ?? 1_920, 320, 4_096);
    const type = input.source === "window" ? "window" : "screen";
    const sources = await desktopCapturer.getSources({
      types: [type],
      thumbnailSize: { width: maxWidth, height: Math.round(maxWidth * 0.75) },
      fetchWindowIcons: false,
    });
    const primaryDisplayId = String(screen.getPrimaryDisplay().id);
    const source = input.sourceId
      ? sources.find((entry) => entry.id === input.sourceId)
      : input.source === "primary" || input.source === undefined
        ? (sources.find((entry) => entry.display_id === primaryDisplayId) ??
          sources[0])
        : sources[0];
    if (!source)
      throw new Error(
        "SCREEN_SOURCE_NOT_FOUND: no matching screen/window source",
      );
    const image = source.thumbnail;
    const size = image.getSize();
    const encoded = input.format === "jpeg" ? image.toJPEG(85) : image.toPNG();
    return {
      type: "image",
      mimeType: input.format === "jpeg" ? "image/jpeg" : "image/png",
      dataBase64: encoded.toString("base64"),
      width: size.width,
      height: size.height,
      sizeBytes: encoded.byteLength,
    };
  }

  public async previewImage(input: ImagePreviewInput): Promise<ToolAttachment> {
    const source = nativeImage.createFromPath(input.path);
    if (source.isEmpty())
      throw new Error(
        `UNSUPPORTED_PREVIEW: Electron could not decode ${input.path}`,
      );
    const original = source.getSize();
    const maxWidth = clamp(input.maxWidth ?? 2_048, 320, 4_096);
    const image =
      original.width > maxWidth
        ? source.resize({ width: maxWidth, quality: "good" })
        : source;
    const size = image.getSize();
    const format = input.format ?? "jpeg";
    const encoded = format === "png" ? image.toPNG() : image.toJPEG(88);
    return {
      type: "image",
      mimeType: format === "png" ? "image/png" : "image/jpeg",
      dataBase64: encoded.toString("base64"),
      width: size.width,
      height: size.height,
      sizeBytes: encoded.byteLength,
    };
  }

  public async listWindows(): Promise<WindowInfo[]> {
    const captureSources = await desktopCapturer
      .getSources({
        types: ["window"],
        thumbnailSize: { width: 1, height: 1 },
        fetchWindowIcons: false,
      })
      .catch(() => []);
    const own = BrowserWindow.getAllWindows().map((window) => {
      const bounds = window.getBounds();
      const title = window.getTitle();
      const captureSource = captureSources.find(
        (source) => source.name === title,
      );
      return {
        id: `qnector-window-${window.webContents.id}`,
        title,
        processName: "Qnector",
        pid: process.pid,
        bounds,
        minimized: window.isMinimized(),
        ...(captureSource ? { captureSourceId: captureSource.id } : {}),
      };
    });
    const external = await this.windows.listWindows().catch(() => []);
    return [
      ...own,
      ...external.map((window) => {
        const captureSource = captureSources.find(
          (source) => source.name === window.title,
        );
        return captureSource
          ? { ...window, captureSourceId: captureSource.id }
          : window;
      }),
    ];
  }

  public async focusWindow(id: string): Promise<void> {
    if (id.startsWith("qnector-window-")) {
      const webContentsId = Number(id.slice("qnector-window-".length));
      const target = BrowserWindow.getAllWindows().find(
        (window) => window.webContents.id === webContentsId,
      );
      if (!target) throw new Error(`WINDOW_NOT_FOUND: ${id}`);
      if (target.isMinimized()) target.restore();
      target.show();
      target.focus();
      return;
    }
    await this.windows.focusWindow(id);
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}
