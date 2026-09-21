import { agentReachDoctor } from "./agent-reach-doctor.js";
import { discoverSocialEnvironment } from "./agent-reach-environment.js";
import { resolveSocialBackend } from "./backend-resolver.js";
import { validatedSocialUrl } from "./command-runner.js";
import { youtubeRead, youtubeSearch } from "./adapters/youtube.js";
import { facebookSearch } from "./adapters/opencli.js";
import type {
  SocialData,
  SocialEnvironment,
  SocialPlatform,
  SocialRequest,
} from "./types.js";

const operations = {
  youtube: ["read", "search"],
  facebook: ["search"],
} as const;
function data(
  action: SocialRequest["action"],
  platform?: SocialPlatform,
): SocialData {
  return {
    summary: `Social ${action} response`,
    operation: action,
    platform,
    status: "limited",
    items: [],
    retrievedAt: new Date().toISOString(),
    completeness: "METADATA_ONLY",
    warnings: [],
    nextCursor: null,
  };
}
export async function executeSocialRead(
  config: SocialEnvironment,
  request: SocialRequest,
  signal?: AbortSignal,
): Promise<SocialData> {
  if (
    !["health", "capabilities", "read", "search", "feed", "profile"].includes(
      request.action,
    )
  )
    throw new Error(
      "UNSUPPORTED_OPERATION: Durable social jobs are not available until P4 packaged tests pass.",
    );
  const environment = await discoverSocialEnvironment(config);
  const doctorOptions = {
    ...(environment.node ? { nodePath: environment.node } : {}),
    ...(environment.backends.facebook && environment.node
      ? { opencliPath: environment.backends.facebook }
      : {}),
  };
  if (request.action === "health" || request.action === "capabilities") {
    const result = data(request.action);
    result.status = !environment.enabled
      ? "disabled"
      : !environment.doctor
        ? "not_installed"
        : "limited";
    let channels: Awaited<ReturnType<typeof agentReachDoctor>> | undefined;
    if (environment.enabled && environment.doctor) {
      try {
        channels = await agentReachDoctor(
          environment.doctor,
          signal,
          doctorOptions,
        );
      } catch {
        if (signal?.aborted)
          throw new Error("CANCELED: Social health check canceled.");
        result.warnings.push(
          "DOCTOR_UNAVAILABLE: Agent Reach could not verify backend availability.",
        );
      }
    }
    const youtubeAvailable = Boolean(
      environment.enabled &&
      config.platforms.includes("youtube") &&
      environment.backends.youtube &&
      channels?.youtube?.toLowerCase() === "yt-dlp",
    );
    const facebookAvailable = Boolean(
      environment.enabled &&
      config.platforms.includes("facebook") &&
      environment.backends.facebook &&
      environment.node &&
      channels?.facebook?.toLowerCase() === "opencli" &&
      config.authMode === "existing-chrome-session",
    );
    result.capabilities = {
      youtubeRead: youtubeAvailable,
      youtubeSearch: youtubeAvailable,
      facebookSearch: facebookAvailable,
      facebookFeed: false,
      facebookPostRead: false,
      durable: false,
    };
    result.warnings.push(
      "Doctor backend presence is not proof of authenticated Facebook content access. Verify manual Chrome extension login and a successful read separately.",
    );
    result.summary = !environment.enabled
      ? "Social feature disabled by default"
      : "Social health checked; authenticated content access is not yet proven";
    return result;
  }
  const platform = request.platform;
  if (!platform || !Object.hasOwn(operations, platform))
    throw new Error("INVALID_INPUT: Specify youtube or facebook.");
  if (!config.enabled || !config.platforms.includes(platform))
    throw new Error(
      "CHANNEL_DISABLED: Social reading is opt-in; enable this platform explicitly.",
    );
  if (request.action === "read" && platform === "youtube")
    validatedSocialUrl(request.url ?? "", platform);
  if (request.action === "read" && platform === "facebook")
    throw new Error(
      "UNSUPPORTED_OPERATION: Arbitrary Facebook post URLs have not been verified with OpenCLI.",
    );
  if (request.action === "feed" || request.action === "profile")
    throw new Error(
      "UNSUPPORTED_OPERATION: Operation not validated with the installed upstream CLI.",
    );
  const limit = request.limit ?? 5;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20)
    throw new Error("INVALID_INPUT: limit must be between 1 and 20.");
  if (
    request.action === "search" &&
    (!request.query || request.query.length > 200 || !request.query.trim())
  )
    throw new Error(
      "INVALID_INPUT: Search query must contain 1-200 characters.",
    );
  if (!environment.doctor)
    throw new Error(
      "NOT_INSTALLED: Configure a pinned absolute Agent Reach doctor executable path first.",
    );
  const channels = await agentReachDoctor(
    environment.doctor,
    signal,
    doctorOptions,
  );
  const backendPath = resolveSocialBackend(
    platform,
    request.action,
    config,
    channels,
    environment.backends,
  );
  const timeout = config.timeoutMs ?? 12000;
  const output =
    platform === "youtube"
      ? request.action === "read"
        ? await youtubeRead(
            backendPath,
            request.url ?? "",
            timeout,
            signal,
            environment.node ?? undefined,
          )
        : await youtubeSearch(
            backendPath,
            request.query ?? "",
            limit,
            timeout,
            signal,
            environment.node ?? undefined,
          )
      : await facebookSearch(
          backendPath,
          request.query ?? "",
          limit,
          timeout,
          signal,
          environment.node ?? undefined,
        );
  const result = data(request.action, platform);
  result.backend = platform === "youtube" ? "yt-dlp" : "opencli";
  result.status = "ready";
  result.items = output.items.slice(0, limit);
  result.completeness = output.completeness;
  result.warnings = output.warnings;
  if ("sourceUrl" in output) result.sourceUrl = output.sourceUrl as string;
  result.summary = `${platform} ${request.action}: ${result.items.length} verified item(s); ${result.completeness}`;
  return result;
}
