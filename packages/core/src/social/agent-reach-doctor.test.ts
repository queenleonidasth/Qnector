import { beforeEach, expect, it, vi } from "vitest";
import { agentReachDoctor, invalidateAgentReachDoctor } from "./agent-reach-doctor.js";
import { socialExec } from "./command-runner.js";

vi.mock("./command-runner.js", () => ({ socialExec: vi.fn() }));
const exec = vi.mocked(socialExec);
const doctor = (status: string, active: string | null = null) => JSON.stringify({
  youtube: { status: "warn", active_backend: "yt-dlp" },
  facebook: { status, active_backend: active },
});
const options = { opencliPath: "C:\\isolated\\opencli\\main.js", nodePath: "C:\\node.exe" };
beforeEach(() => { vi.resetAllMocks(); invalidateAgentReachDoctor(); });

it("recognizes a verified OpenCLI transport despite Agent Reach's intentionally unverified Facebook status", async () => {
  exec.mockResolvedValueOnce(doctor("warn")).mockResolvedValueOnce(
    "[OK] Extension: connected (v1.0.24)\n[OK] Connectivity: connected in 0.1s",
  );
  const result = await agentReachDoctor("C:\\agent-reach.exe", undefined, options);
  expect(result.facebook).toBe("OpenCLI");
  expect(exec).toHaveBeenCalledTimes(2);
});

it("fails closed when only a daemon is alive but the browser extension is disconnected", async () => {
  exec.mockResolvedValueOnce(doctor("warn")).mockResolvedValueOnce(
    "[OK] Daemon: running\n[FAIL] Extension: disconnected",
  );
  expect((await agentReachDoctor("C:\\agent-reach.exe", undefined, options)).facebook).toBeNull();
});

it("does not promote an off channel even if a separate bridge exists", async () => {
  exec.mockResolvedValueOnce(doctor("off"));
  expect((await agentReachDoctor("C:\\agent-reach.exe", undefined, options)).facebook).toBeNull();
  expect(exec).toHaveBeenCalledTimes(1);
});
