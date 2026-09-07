import { BrowserWindow, nativeImage } from "electron";
import { existsSync } from "node:fs";

export const MIN_SPLASH_VISIBLE_MS = 360;

const splashShownAt = new WeakMap<BrowserWindow, number>();
const splashCloseTimers = new WeakMap<
  BrowserWindow,
  ReturnType<typeof setTimeout>
>();

export interface SplashWindowOptions {
  iconPath?: string;
}

export function createSplashWindow(
  options: SplashWindowOptions = {},
): BrowserWindow {
  const icon =
    options.iconPath && existsSync(options.iconPath)
      ? nativeImage.createFromPath(options.iconPath)
      : undefined;
  const splash = new BrowserWindow({
    width: 372,
    height: 246,
    center: true,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    // Show the lightweight shell immediately instead of depending on the
    // ready-to-show timing of a tiny data: URL. backgroundColor prevents a
    // white flash while the self-contained HTML paints.
    show: true,
    focusable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#101216",
    icon,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  splashShownAt.set(splash, Date.now());
  splash.on("closed", () => {
    const timer = splashCloseTimers.get(splash);
    if (timer) clearTimeout(timer);
    splashCloseTimers.delete(splash);
    splashShownAt.delete(splash);
  });
  void splash.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(splashHtml())}`,
  );
  return splash;
}

export function closeSplashWindow(splash?: BrowserWindow): void {
  if (!splash || splash.isDestroyed()) return;
  const shownAt = splashShownAt.get(splash) ?? Date.now();
  const remainingMs = Math.max(
    0,
    MIN_SPLASH_VISIBLE_MS - (Date.now() - shownAt),
  );
  if (remainingMs === 0) {
    splash.close();
    return;
  }
  const existing = splashCloseTimers.get(splash);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    splashCloseTimers.delete(splash);
    if (!splash.isDestroyed()) splash.close();
  }, remainingMs);
  timer.unref?.();
  splashCloseTimers.set(splash, timer);
}

export function splashHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Starting Qnector</title>
<style>
:root{color-scheme:dark;font-family:Inter,"Segoe UI",system-ui,sans-serif;background:#101216}
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#101216}
body{display:grid;place-items:center;color:#f5f5f4;-webkit-user-select:none;user-select:none}
.shell{width:100%;height:100%;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:28px;border:1px solid rgba(255,255,255,.07);background:radial-gradient(circle at 50% 38%,rgba(215,181,109,.11),transparent 35%),linear-gradient(180deg,#15171c 0%,#0e1014 100%)}
.shell:before{content:"";position:absolute;inset:0;background:linear-gradient(120deg,transparent 15%,rgba(255,255,255,.025) 42%,transparent 62%);pointer-events:none}
.mark{position:relative;width:64px;height:64px;display:grid;place-items:center;margin-bottom:18px}
.ring{position:absolute;inset:0;border-radius:50%;border:1px solid rgba(231,206,151,.22);box-shadow:0 0 28px rgba(204,166,87,.08)}
.ring:after{content:"";position:absolute;inset:6px;border-radius:50%;border:1px solid transparent;border-top-color:#d6b66f;border-right-color:rgba(214,182,111,.24);animation:spin 1.15s cubic-bezier(.45,.05,.55,.95) infinite}
.core{width:28px;height:28px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#f3e4bd 0%,#c8a45a 28%,#6f5426 72%,#2a2113 100%);box-shadow:0 0 22px rgba(213,178,100,.18)}
.brand{font-size:20px;font-weight:650;letter-spacing:.16em;margin-left:.16em;color:#f7f5ef}
.status{margin-top:8px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#9b9da4}
.track{width:176px;height:2px;margin-top:20px;overflow:hidden;border-radius:99px;background:rgba(255,255,255,.07)}
.track:after{content:"";display:block;width:42%;height:100%;border-radius:inherit;background:linear-gradient(90deg,transparent,#d6b66f,transparent);animation:load 1.25s ease-in-out infinite}
.hint{position:absolute;bottom:15px;font-size:9px;letter-spacing:.08em;color:#5f626a}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes load{0%{transform:translateX(-115%)}100%{transform:translateX(340%)}}
@media (prefers-reduced-motion:reduce){.ring:after,.track:after{animation:none}.track:after{width:65%;background:#b99755}}
</style>
</head>
<body>
  <main class="shell" role="status" aria-live="polite" aria-label="Qnector is starting">
    <div class="mark" aria-hidden="true"><div class="ring"></div><div class="core"></div></div>
    <div class="brand">QNECTOR</div>
    <div class="status">Preparing workspace</div>
    <div class="track" aria-hidden="true"></div>
    <div class="hint">LOCAL MCP DESKTOP BRIDGE</div>
  </main>
</body>
</html>`;
}
