import type {
  SocialEnvironment,
  SocialOperation,
  SocialPlatform,
} from "./types.js";
import type { DoctorChannels } from "./agent-reach-doctor.js";

export function resolveSocialBackend(
  platform: SocialPlatform,
  operation: SocialOperation,
  config: SocialEnvironment,
  channels: DoctorChannels,
  paths: { youtube: string | null; facebook: string | null },
): string {
  if (!config.enabled || !config.platforms.includes(platform))
    throw new Error(
      "CHANNEL_DISABLED: Enable the platform explicitly in Qnector social settings.",
    );
  const allowed = platform === "youtube" ? ["read", "search"] : ["search"];
  if (!allowed.includes(operation))
    throw new Error(
      "UNSUPPORTED_OPERATION: This operation is not verified for the selected platform.",
    );
  if (platform === "facebook" && config.authMode !== "existing-chrome-session")
    throw new Error(
      "AUTH_REQUIRED: Authorize a pre-existing Chrome session manually; no login or cookie extraction is automated.",
    );
  if (!paths[platform])
    throw new Error(
      "NOT_INSTALLED: Select an absolute upstream backend executable before enabling the platform.",
    );
  const expected = platform === "youtube" ? "yt-dlp" : "opencli";
  if (platform === "facebook" && !channels.facebook)
    throw new Error(
      "EXTENSION_DISCONNECTED: OpenCLI extension is not connected; open an authorized Chrome session manually.",
    );
  if (!channels[platform]?.toLowerCase().includes(expected))
    throw new Error(
      "BACKEND_UNAVAILABLE: Agent Reach doctor has not confirmed this backend; check the pinned installation.",
    );
  return paths[platform];
}
