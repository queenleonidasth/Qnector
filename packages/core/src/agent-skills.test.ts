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

  it("plans dynamic runtime activation and drops weak lexical false positives", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-skills-route-"));
    const definitions = [
      [
        "ui-ux-design",
        "Design beautiful frontend interfaces with animation and polished interaction.",
      ],
      [
        "loading-motion-design",
        "Design interface animation, transition, loading, and motion behavior.",
      ],
      [
        "ui-ux-audit",
        "Audit frontend design quality, usability, layout, and visual polish.",
      ],
      [
        "archive-workflows",
        "Create ZIP archives for frontend build artifacts.",
      ],
    ] as const;
    for (const [name, description] of definitions) {
      const directory = path.join(root, name);
      await mkdir(directory, { recursive: true });
      await writeFile(
        path.join(directory, "SKILL.md"),
        [
          "---",
          `name: ${name}`,
          `description: "${description}"`,
          "---",
          `# ${name}`,
          "Test instructions.",
          "",
        ].join("\n"),
        "utf8",
      );
    }

    const service = new AgentSkillService({
      roots: [{ path: root, source: "test" }],
    });
    const matched = await service.match("design animation frontend", 5);
    const activated = await service.route("design animation frontend", 5);

    expect(matched.map((skill) => skill.name)).toContain("archive-workflows");
    expect(activated.map((skill) => skill.name)).toEqual([
      "ui-ux-design",
      "loading-motion-design",
    ]);
  });

  it("uses routing metadata, suppresses generic dev terms, and explains selection", async () => {
    root = await mkdtemp(
      path.join(tmpdir(), "qnector-skills-routing-metadata-"),
    );
    const definitions = [
      {
        name: "ui-ux-design",
        description: "Design and implement polished user interfaces.",
        routing: [
          "  positive-triggers: [ui, ux, frontend, interact, interactive, make it beautiful, ทำให้สวย, ดูไม่สวย]",
          "  negative-triggers: [spreadsheet, xlsx]",
          "  capabilities: [ui-design]",
        ],
      },
      {
        name: "loading-motion-design",
        description: "Design loading states and interface motion.",
        routing: [
          "  positive-triggers: [animation, motion, transition, แอนิเมชัน]",
          "  capabilities: [motion]",
        ],
      },
      {
        name: "ui-ux-audit",
        description:
          "Audit an existing interface for visual and usability defects.",
        routing: [
          "  positive-triggers: [audit ui, check ui, looks bad, ดูไม่สวย]",
          "  capabilities: [ui-audit]",
        ],
      },
      {
        name: "test-driven-development",
        description: "Use TDD when implementing features and bug fixes.",
        routing: [
          "  positive-triggers: [tdd, test driven, write tests first, เขียนเทสต์ก่อน]",
          "  capabilities: [testing]",
        ],
      },
      {
        name: "archive-workflows",
        description: "Create and extract archives and ZIP files.",
        routing: [
          "  positive-triggers: [zip, unzip, archive, extract]",
          "  negative-triggers: [frontend, ui, animation]",
          "  capabilities: [archive]",
        ],
      },
    ];
    for (const definition of definitions) {
      const directory = path.join(root, definition.name);
      await mkdir(directory, { recursive: true });
      await writeFile(
        path.join(directory, "SKILL.md"),
        [
          "---",
          `name: ${definition.name}`,
          `description: "${definition.description}"`,
          "routing:",
          ...definition.routing,
          "---",
          `# ${definition.name}`,
          "Test instructions.",
          "",
        ].join("\n"),
        "utf8",
      );
    }

    const service = new AgentSkillService({
      roots: [{ path: root, source: "test" }],
    });
    const plan = await service.plan(
      "มันดูไม่สวย อยากได้ animation แบบ interact ได้ ลอง dev ให้หน่อย",
      5,
    );

    expect(plan.selected.map((skill) => skill.name)).toEqual([
      "ui-ux-design",
      "loading-motion-design",
      "ui-ux-audit",
    ]);
    expect(plan.selected.map((skill) => skill.name)).not.toContain(
      "test-driven-development",
    );
    const archive = plan.decisions.find(
      (decision) => decision.name === "archive-workflows",
    );
    expect(archive?.selected).toBe(false);
    expect(archive?.reasons.join(" ")).toMatch(/negative|irrelevant|below/i);
    expect(
      plan.decisions.find((decision) => decision.name === "ui-ux-design")
        ?.confidence,
    ).toMatch(/high|medium/);
  });

  it("prefers complementary capabilities over duplicate UI design skills", async () => {
    root = await mkdtemp(
      path.join(tmpdir(), "qnector-skills-routing-overlap-"),
    );
    const definitions = [
      ["ui-ux-design", "ui design frontend polish", "ui-design"],
      ["frontend-design", "frontend ui design components", "ui-design"],
      ["ui-ux-pro-max", "advanced ui ux frontend design", "ui-design"],
      ["loading-motion-design", "animation motion transition", "motion"],
    ] as const;
    for (const [name, description, capability] of definitions) {
      const directory = path.join(root, name);
      await mkdir(directory, { recursive: true });
      await writeFile(
        path.join(directory, "SKILL.md"),
        [
          "---",
          `name: ${name}`,
          `description: "${description}"`,
          "routing:",
          `  positive-triggers: [${description.split(" ").join(", ")}]`,
          `  capabilities: [${capability}]`,
          "---",
          `# ${name}`,
          "Test instructions.",
          "",
        ].join("\n"),
        "utf8",
      );
    }

    const service = new AgentSkillService({
      roots: [{ path: root, source: "test" }],
    });
    const plan = await service.plan(
      "design a polished frontend ui with animation",
      5,
    );
    const selectedNames = plan.selected.map((skill) => skill.name);
    expect(selectedNames).toContain("loading-motion-design");
    expect(
      selectedNames.filter((name) =>
        ["ui-ux-design", "frontend-design", "ui-ux-pro-max"].includes(name),
      ),
    ).toHaveLength(1);
    expect(
      plan.decisions.some((decision) => decision.outcome === "overlap"),
    ).toBe(true);
  });

  it("parses folded YAML frontmatter used by ecosystem skills", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-skills-yaml-"));
    const directory = path.join(root, "agent-harness");
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "SKILL.md"),
      [
        "---",
        "name: agent-harness",
        "description: >",
        "  Test and evaluation harness for AI agents â€” scenario suites, deterministic",
        "  replay, regression diffing, cost and latency budgets.",
        "license: MIT",
        "---",
        "# Agent Harness",
        "Use deterministic replay.",
        "",
      ].join("\n"),
      "utf8",
    );
    const service = new AgentSkillService({
      roots: [{ path: root, source: "test" }],
    });
    const loaded = await service.get("agent-harness");
    expect(loaded.description).toContain(
      "scenario suites, deterministic replay",
    );
    expect(loaded.description).not.toBe(">");
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

  it("searches skills.sh and installs a complete snapshot with provenance", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-skills-remote-"));
    const userRoot = path.join(root, "skills");
    const requests: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("/api/search?")) {
        return new Response(
          JSON.stringify({
            skills: [
              {
                id: "vendor/repo/remote-skill",
                skillId: "remote-skill",
                name: "remote-skill",
                source: "vendor/repo",
                installs: 42,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/api/download/vendor/repo/remote-skill")) {
        return new Response(
          JSON.stringify({
            files: [
              {
                path: "SKILL.md",
                contents: [
                  "---",
                  "name: remote-skill",
                  "description: >",
                  "  Remote skill with a folded description for safe discovery and",
                  "  installation testing.",
                  "---",
                  "# Remote Skill",
                  "Follow the workflow.",
                  "",
                ].join("\n"),
              },
              { path: "references/guide.md", contents: "# Guide\n" },
            ],
            hash: "a".repeat(64),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    };
    const service = new AgentSkillService({
      roots: [{ path: userRoot, source: "user" }],
      registryBaseUrl: "https://skills.example.test",
      fetchImpl,
    });

    const found = await service.searchRemote({ query: "remote skill" });
    expect(found).toEqual([
      expect.objectContaining({
        id: "vendor/repo/remote-skill",
        name: "remote-skill",
        source: "vendor/repo",
        installs: 42,
        installable: true,
        installed: false,
      }),
    ]);

    const installed = await service.installRemote(
      "vendor/repo/remote-skill",
      "user",
    );
    expect(installed.description).toContain("folded description");
    expect(installed.origin).toMatchObject({
      registry: "skills.sh",
      id: "vendor/repo/remote-skill",
      source: "vendor/repo",
      skillId: "remote-skill",
      registryHash: "a".repeat(64),
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(
      await readFile(
        path.join(userRoot, "remote-skill", "references", "guide.md"),
        "utf8",
      ),
    ).toContain("Guide");
    expect(requests.some((url) => url.includes("/api/search?"))).toBe(true);
    expect(
      (await service.searchRemote({ query: "remote skill" }))[0]?.installed,
    ).toBe(true);
  });

  it("rejects unsafe paths from remote skill snapshots", async () => {
    root = await mkdtemp(path.join(tmpdir(), "qnector-skills-unsafe-"));
    const service = new AgentSkillService({
      roots: [{ path: path.join(root, "skills"), source: "user" }],
      registryBaseUrl: "https://skills.example.test",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            files: [
              {
                path: "SKILL.md",
                contents:
                  "---\\nname: unsafe-skill\\ndescription: Unsafe fixture.\\n---\\n# Unsafe\\n",
              },
              { path: "../escape.txt", contents: "nope" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });
    await expect(
      service.installRemote("vendor/repo/unsafe-skill", "user"),
    ).rejects.toThrow("unsafe snapshot path");
    await expect(
      readFile(path.join(root, "escape.txt"), "utf8"),
    ).rejects.toThrow();
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
