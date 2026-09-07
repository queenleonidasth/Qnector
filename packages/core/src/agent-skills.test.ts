import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentSkillService } from "./agent-skills.js";

let root: string | undefined;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe("AgentSkillService", () => {
  it("discovers, matches and loads Agent Skills without executing their scripts", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-skills-"));
    const directory = path.join(root, "spreadsheet-workflows");
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "SKILL.md"),
      [
        "---",
        "name: spreadsheet-workflows",
        'description: "Analyze and edit XLSX spreadsheet workbooks."',
        "license: MIT",
        "allowed-tools: [files, process]",
        "---",
        "# Spreadsheet Workflows",
        "Use structure-aware edits.",
        "",
      ].join("\n"),
      "utf8",
    );

    const service = new AgentSkillService({
      roots: [{ path: root, source: "test" }],
    });
    const listed = await service.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.allowedTools).toEqual(["files", "process"]);

    const matched = await service.match("edit xlsx", 3);
    expect(matched[0]?.name).toBe("spreadsheet-workflows");

    const loaded = await service.get("spreadsheet-workflows");
    expect(loaded.instructions).toContain("structure-aware edits");
    expect(loaded.source).toBe("test");
  });

  it("ignores malformed skills instead of breaking discovery", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-skills-invalid-"));
    const directory = path.join(root, "invalid");
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "SKILL.md"),
      "# no frontmatter\n",
      "utf8",
    );

    const service = new AgentSkillService({
      roots: [{ path: root, source: "test" }],
    });
    expect(await service.list()).toEqual([]);
  });
});
