import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig, loadConfig, saveConfig } from "./config.js";

describe("retired Agent Reach configuration compatibility", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it("does not add social settings to a fresh configuration", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-no-social-default-"));
    expect(defaultConfig(root).social).toBeUndefined();
  });

  it("preserves existing settings without activating or removing user integrations", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-legacy-social-"));
    const file = path.join(root, "config.json");
    const legacy = defaultConfig(root);
    legacy.social = {
      enabled: true,
      platforms: ["youtube", "facebook"],
      agentReachPath: path.join(root, "existing", "agent-reach.exe"),
      opencliPath: path.join(root, "existing", "opencli.js"),
      authMode: "existing-chrome-session",
    };

    await saveConfig(legacy, file);
    const loaded = await loadConfig({ file });
    expect(loaded.social).toEqual(legacy.social);
    await saveConfig({ ...loaded, ui: { ...loaded.ui, theme: "dark" } }, file);
    expect(
      (JSON.parse(await readFile(file, "utf8")) as typeof legacy).social,
    ).toEqual(legacy.social);
  });
});
