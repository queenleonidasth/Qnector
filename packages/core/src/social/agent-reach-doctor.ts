import { socialExec, type SocialExecOptions } from "./command-runner.js";

export interface DoctorChannels { youtube: string | null; facebook: string | null; }
let cached: { key: string; expiry: number; channels: DoctorChannels } | undefined;

/** Doctor is read-only; its active backend is NOT proof of Facebook account authentication. */
export async function agentReachDoctor(executable: string, signal?: AbortSignal, options: SocialExecOptions = {}): Promise<DoctorChannels> {
  const key = JSON.stringify([executable, options.opencliPath, options.nodePath]);
  if (cached?.key === key && cached.expiry > Date.now()) return cached.channels;
  const raw = await socialExec(executable, ["doctor", "--json"], 15000, signal, options);
  let report: unknown;
  try { report = JSON.parse(raw) as unknown; }
  catch { throw new Error("DOCTOR_UNAVAILABLE: Agent Reach returned invalid JSON."); }
  if (!report || typeof report !== "object" || Array.isArray(report))
    throw new Error("DOCTOR_UNAVAILABLE: Agent Reach returned an unknown report format.");
  const channels = report as Record<string, unknown>;
  if (!channels.youtube || !channels.facebook)
    throw new Error("DOCTOR_UNAVAILABLE: Missing expected platform entries.");
  const get = (platform: "youtube" | "facebook") => {
    const channel = channels[platform];
    if (!channel || typeof channel !== "object" || Array.isArray(channel)) return null;
    const row = channel as Record<string, unknown>;
    if (!["ok", "warn"].includes(String(row.status))) return null;
    return typeof row.active_backend === "string" && row.active_backend.length < 100 ? row.active_backend : null;
  };
  const selected = {youtube:get("youtube"), facebook:get("facebook")};
  // Recent Agent Reach deliberately reports Facebook as warn/active_backend=null
  // even when its browser bridge is connected: doctor never probes an account.
  // Confirm bridge transport separately using the pinned read-only OpenCLI doctor.
  // Authentication/content must still be proven with an explicit search before save.
  const fb = channels.facebook as Record<string, unknown>;
  if (!selected.facebook && fb.status === "warn" && options.opencliPath && options.nodePath) {
    try {
      const bridge = await socialExec(options.opencliPath, ["doctor"], 12000, signal, { nodePath: options.nodePath });
      if (/\[OK\] Extension:\s*connected\b/i.test(bridge) && /\[OK\] Connectivity:\s*connected\b/i.test(bridge)) {
        selected.facebook = "OpenCLI";
      }
    } catch {
      if (signal?.aborted) throw new Error("CANCELED: Social doctor canceled.");
      // Fail closed: a missing or disconnected bridge is not Facebook readiness.
    }
  }
  cached = { key, expiry:Date.now()+30000, channels:selected };
  return selected;
}
export function invalidateAgentReachDoctor(): void { cached = undefined; }
