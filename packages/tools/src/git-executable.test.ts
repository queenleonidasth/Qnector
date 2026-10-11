import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { locateGitExecutable } from "./git-executable.js";

describe("locateGitExecutable", () => {
  it("uses a valid explicit Git path even if Git is absent from PATH", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "qnector-git-locator-"),
    );
    const fakeGit = path.join(
      directory,
      process.platform === "win32" ? "git.exe" : "git",
    );
    const previous = process.env.QNECTOR_GIT_PATH;
    try {
      await writeFile(fakeGit, "");
      process.env.QNECTOR_GIT_PATH = fakeGit;
      expect(await locateGitExecutable()).toBe(fakeGit);
    } finally {
      if (previous === undefined) delete process.env.QNECTOR_GIT_PATH;
      else process.env.QNECTOR_GIT_PATH = previous;
      await rm(directory, { recursive: true, force: true });
    }
  });
});
