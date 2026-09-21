import { spawn } from "node:child_process";
import path from "node:path";
import { stringInput, type ToolContext } from "./tool-result.js";
/** Desktop presentation and capture adapter, called only for explicit system actions. */
export async function executeSystemDesktop(
  context: ToolContext,
  action: string,
  object: Record<string, unknown>,
) {
  if (action === "open_path") {
    requirePresentationIntent(object, action);
    const target = path.resolve(stringInput(object, "path", true)!);
    openExternal(target);
    return { summary: `Opened ${target}`, data: { path: target } };
  }
  if (action === "open_url") {
    requirePresentationIntent(object, action);
    const url = stringInput(object, "url", true)!;
    openExternal(url);
    return { summary: `Opened ${url}`, data: { url } };
  }
  if (action === "clipboard_read") {
    const result = await requirePlatform(context).readClipboard();
    return {
      summary: `Read ${result.sizeBytes} clipboard bytes`,
      data: result,
      truncated: result.truncated,
    };
  }
  if (action === "clipboard_write") {
    const text = stringInput(object, "text", true)!;
    if (text.length > 1_000_000)
      throw new Error("CLIPBOARD_TOO_LARGE: text exceeds 1000000 characters");
    const html = stringInput(object, "html");
    if (html && html.length > 1_000_000)
      throw new Error("CLIPBOARD_TOO_LARGE: html exceeds 1000000 characters");
    await requirePlatform(context).writeClipboard({
      text,
      ...(html ? { html } : {}),
    });
    return {
      summary: `Wrote ${Buffer.byteLength(text, "utf8")} clipboard bytes`,
      data: { type: "text", bytes: Buffer.byteLength(text, "utf8") },
    };
  }
  if (action === "toast") {
    requirePresentationIntent(object, action);
    const title = stringInput(object, "title", true)!;
    const body = stringInput(object, "body", true)!;
    if (title.length > 160)
      throw new Error(
        "INVALID_INPUT: toast title must be 160 characters or fewer",
      );
    if (body.length > 2_000)
      throw new Error(
        "INVALID_INPUT: toast body must be 2000 characters or fewer",
      );
    await requirePlatform(context).showToast({
      title,
      body,
      silent: object.silent === true,
    });
    return {
      summary: `Displayed notification '${title}'`,
      data: { title },
    };
  }
  if (action === "screen_capture") {
    const source = stringInput(object, "source") ?? "primary";
    if (!["primary", "screen", "window"].includes(source))
      throw new Error(`INVALID_INPUT: unsupported capture source '${source}'`);
    const format = stringInput(object, "format") ?? "jpeg";
    if (!["png", "jpeg"].includes(format))
      throw new Error(`INVALID_INPUT: unsupported capture format '${format}'`);
    const attachment = await requirePlatform(context).captureScreen({
      source: source as "primary" | "screen" | "window",
      ...(stringInput(object, "sourceId")
        ? { sourceId: stringInput(object, "sourceId") }
        : {}),
      format: format as "png" | "jpeg",
      maxWidth: typeof object.maxWidth === "number" ? object.maxWidth : 1_600,
    });
    return {
      summary: `Captured ${attachment.mimeType} image (${attachment.sizeBytes ?? 0} bytes)`,
      data: {
        type: "image",
        mimeType: attachment.mimeType,
        width: attachment.width,
        height: attachment.height,
        sizeBytes: attachment.sizeBytes,
      },
      attachments: [attachment],
    };
  }
  if (action === "window_list") {
    if (context.uiAutomation) {
      try {
        const semanticWindows = await context.uiAutomation.windows(100);
        const windows = semanticWindows.map((entry) => ({
          id: `window_${entry.processId}`,
          title: entry.name,
          processName: "",
          pid: entry.processId,
        }));
        return {
          summary: `Listed ${windows.length} window(s) via native UI Automation`,
          data: { windows, provider: "ui-automation" },
        };
      } catch {
        // Fall back to the platform implementation for compatibility.
      }
    }
    const windows = await requirePlatform(context).listWindows();
    return {
      summary: `Listed ${windows.length} window(s)`,
      data: { windows, provider: "platform" },
    };
  }
  if (action === "window_focus") {
    requirePresentationIntent(object, action);
    const windowId =
      stringInput(object, "windowId") ?? stringInput(object, "id", true)!;
    await requirePlatform(context).focusWindow(windowId);
    return { summary: `Focused window ${windowId}`, data: { windowId } };
  }
  throw new Error(`INVALID_ACTION: Unknown desktop action '${action}'`);
}

function requirePresentationIntent(
  object: Record<string, unknown>,
  action: string,
): void {
  if (object.presentToUser === true) return;
  throw new Error(
    `VISIBLE_UI_BLOCKED: system.${action} is presentation-only. Keep intermediate work headless; set presentToUser=true only when intentionally showing final output to the user.`,
  );
}

function requirePlatform(context: ToolContext) {
  if (!context.platform)
    throw new Error(
      "UNSUPPORTED_CAPABILITY: platform services are not configured",
    );
  return context.platform;
}

function openExternal(target: string): void {
  if (process.platform === "win32") {
    const child = spawn("cmd.exe", ["/c", "start", "", target], {
      detached: true,
      windowsHide: true,
      stdio: "ignore",
    });
    child.unref();
    return;
  }
  const executable = process.platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(executable, [target], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}
