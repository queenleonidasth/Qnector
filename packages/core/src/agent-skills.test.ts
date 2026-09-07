import AdmZip from "adm-zip";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

  it("creates, disables, duplicates and re-enables writable skills", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-skills-manage-"));
    const userRoot = path.join(root, "skills");
    const service = new AgentSkillService({
      roots: [{ path: userRoot, source: "user" }],
    });

    const created = await service.create({
      scope: "user",
      name: "my-skill",
      description: "Helps manage a custom workflow.",
      instructions: "# My Skill\n\nFollow the workflow.",
      license: "MIT",
      allowedTools: ["files", "process"],
    });
    expect(created.source).toBe("user");
    expect(created.enabled).toBe(true);

    await service.setEnabled("my-skill", false);
    expect(await service.match("custom workflow")).toEqual([]);
    expect((await service.status()).disabledCount).toBe(1);
    expect(
      await service.get("my-skill", { includeDisabled: true }),
    ).toMatchObject({
      enabled: false,
    });

    await service.setEnabled("my-skill", true);
    const duplicate = await service.duplicate(
      "my-skill",
      "user",
      "my-skill-copy",
    );
    expect(duplicate.name).toBe("my-skill-copy");
    expect((await service.status()).skillCount).toBe(2);
  });

  it("imports a packaged ZIP skill without allowing it to escape the skill root", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-skills-import-"));
    const userRoot = path.join(root, "skills");
    const archive = path.join(root, "import-skill.zip");
    const zip = new AdmZip();
    zip.addFile(
      "import-skill/SKILL.md",
      Buffer.from(
        [
          "---",
          "name: import-skill",
          'description: "Imported ZIP workflow."',
          "allowed-tools: files process",
          "---",
          "# Import Skill",
          "Use the imported workflow.",
          "",
        ].join("\n"),
      ),
    );
    zip.addFile(
      "import-skill/references/example.txt",
      Buffer.from("reference"),
    );
    zip.writeZip(archive);

    const service = new AgentSkillService({
      roots: [{ path: userRoot, source: "user" }],
    });
    const imported = await service.importSkill(archive, "user");
    expect(imported.name).toBe("import-skill");
    expect(imported.instructions).toContain("imported workflow");
    expect(
      await readFile(
        path.join(userRoot, "import-skill", "references", "example.txt"),
        "utf8",
      ),
    ).toBe("reference");
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
