import { spawnSync } from "node:child_process";
import path from "node:path";
import { executeSocialRead } from "@qnector/core";
import type { QnectorConfig } from "@qnector/shared";

export type SocialConfig = NonNullable<QnectorConfig["social"]>;

/** An explicit one-click, per-user opt-in. Never installs, starts Chrome or edits PATH. */
export async function configureLocalYouTube(
  current: SocialConfig | undefined,
  localAppData: string | undefined,
  nodeExecutable: string | undefined,
  enabled: boolean,
): Promise<SocialConfig> {
  const previous: SocialConfig = current ?? { enabled: false, platforms: [] };
  if (!enabled) {
    const platforms = previous.platforms.filter(
      (platform) => platform !== "youtube",
    );
    return { ...previous, enabled: platforms.length > 0, platforms };
  }
  if (
    !localAppData ||
    !path.isAbsolute(localAppData) ||
    !nodeExecutable ||
    !path.isAbsolute(nodeExecutable)
  ) {
    throw new Error(
      "NOT_INSTALLED: A local Agent Reach installation and absolute Node.js executable are required.",
    );
  }
  const root = path.join(
    localAppData,
    "Qnector",
    "integrations",
    "agent-reach",
  );
  const candidate: SocialConfig = {
    ...previous,
    enabled: true,
    platforms: [
      ...new Set([...previous.platforms, "youtube"]),
    ] as SocialConfig["platforms"],
    agentReachPath: path.join(root, "venv", "Scripts", "agent-reach.exe"),
    youtubePath: path.join(root, "venv", "Scripts", "yt-dlp.exe"),
    nodePath: nodeExecutable,
    timeoutMs: previous.timeoutMs ?? 20000,
  };
  // Health uses vetted absolute paths, a bounded read-only doctor and no account data.
  const health = await executeSocialRead(candidate, { action: "health" });
  if (!health.capabilities?.youtubeRead || !health.capabilities.youtubeSearch) {
    throw new Error(
      "BACKEND_UNAVAILABLE: Isolated Agent Reach/yt-dlp is not ready. Social config was not changed.",
    );
  }
  return candidate;
}

/**
 * Explicit manual-session verification only. The user must have installed and
 * connected the OpenCLI extension and signed in to Facebook themselves.
 * Never persists an enabled Facebook config based on a doctor badge alone.
 */
export async function configureLocalFacebook(
  current: SocialConfig | undefined,
  localAppData: string | undefined,
  nodeExecutable: string | undefined,
  enabled: boolean,
): Promise<SocialConfig> {
  const previous: SocialConfig = current ?? { enabled: false, platforms: [] };
  if (!enabled) {
    const platforms = previous.platforms.filter(
      (platform) => platform !== "facebook",
    );
    return { ...previous, enabled: platforms.length > 0, platforms };
  }
  if (
    !localAppData ||
    !path.isAbsolute(localAppData) ||
    !nodeExecutable ||
    !path.isAbsolute(nodeExecutable)
  ) {
    throw new Error(
      "NOT_INSTALLED: Install the isolated Agent Reach/OpenCLI integration and select an absolute Node.js path first.",
    );
  }
  const root = path.join(
    localAppData,
    "Qnector",
    "integrations",
    "agent-reach",
  );
  const candidate: SocialConfig = {
    ...previous,
    enabled: true,
    platforms: [
      ...new Set([...previous.platforms, "facebook"]),
    ] as SocialConfig["platforms"],
    agentReachPath: path.join(root, "venv", "Scripts", "agent-reach.exe"),
    opencliPath: path.join(
      root,
      "opencli",
      "node_modules",
      "@jackwener",
      "opencli",
      "dist",
      "src",
      "main.js",
    ),
    nodePath: nodeExecutable,
    authMode: "existing-chrome-session",
    timeoutMs: previous.timeoutMs ?? 20000,
  };
  // Doctor never starts a browser and cannot establish account authorization.
  const health = await executeSocialRead(candidate, { action: "health" });
  if (!health.capabilities?.facebookSearch) {
    throw new Error(
      "EXTENSION_DISCONNECTED: Install/enable the OpenCLI Chrome extension, sign in manually, connect the OpenCLI daemon, then verify again. No settings were changed.",
    );
  }
  // This read-only search can navigate an authenticated browser tab: run ONLY
  // after a deliberate user click, never at startup or in a background probe.
  const verified = await executeSocialRead(candidate, {
    action: "search",
    platform: "facebook",
    query: "OpenAI",
    limit: 1,
  });
  if (verified.status !== "ready" || verified.items.length === 0) {
    throw new Error(
      "CONTENT_UNAVAILABLE: Facebook returned no verified search result. No settings were changed.",
    );
  }
  return candidate;
}

/** Finds Node without running it or inheriting its environment into a social backend. */
export function findLocalNode(): string | undefined {
  if (process.platform !== "win32") return undefined;
  const result = spawnSync("where.exe", ["node.exe"], {
    encoding: "utf8",
    timeout: 2000,
    windowsHide: true,
    maxBuffer: 4096,
  });
  if (result.status !== 0) return undefined;
  return result.stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find(
      (value) =>
        path.isAbsolute(value) &&
        path.basename(value).toLowerCase() === "node.exe",
    );
}
