import { checkedExecutable, checkedNode } from "./command-runner.js";
import type { SocialEnvironment, SocialPlatform } from "./types.js";

/** No global PATH or auto-install: each backend is selected by absolute path. */
export async function discoverSocialEnvironment(config: SocialEnvironment) {
  const [doctor, youtube, facebook, node] = await Promise.all([
    checkedExecutable(config.agentReachPath),
    checkedExecutable(config.youtubePath),
    checkedExecutable(config.opencliPath),
    checkedNode(config.nodePath),
  ]);
  return {
    enabled: config.enabled === true,
    doctor,
    node,
    backends: { youtube, facebook } satisfies Record<SocialPlatform, string | null>,
    authMode: config.authMode ?? null,
  };
}
