import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { executeSocialRead } from "./service.js";
import { resolveSocialBackend } from "./backend-resolver.js";

it("never calls an unverified Facebook session connected in health", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "qnector-fb-health-"));
  try {
    const doctor = path.join(root, "agent-reach.exe");
    const opencli = path.join(root, "opencli.exe");
    await writeFile(doctor, "not a valid executable");
    await writeFile(opencli, "not a valid executable");
    const health = await executeSocialRead({ enabled:true,platforms:["facebook"],agentReachPath:doctor,opencliPath:opencli,authMode:"existing-chrome-session" }, { action:"health" });
    expect(health.capabilities?.facebookSearch).toBe(false);
    expect(health.status).not.toBe("ready");
  } finally { await rm(root, {recursive:true,force:true}); }
});
it("surfaces an extension-disconnected error rather than fabricating Facebook data", () => {
  expect(() => resolveSocialBackend("facebook", "search", {enabled:true,platforms:["facebook"],authMode:"existing-chrome-session"}, {youtube:"yt-dlp",facebook:null}, {youtube:null,facebook:"C:\\pinned\\opencli.exe"})).toThrow("EXTENSION_DISCONNECTED");
});
