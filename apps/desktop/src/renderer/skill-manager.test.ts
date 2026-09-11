import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const rendererUrl = new URL("./renderer.tsx", import.meta.url);
const skillUrl = new URL("./skill-manager.tsx", import.meta.url);
const cssUrl = new URL("./skill-manager.css", import.meta.url);

describe("desktop Skill Manager", () => {
  it("replaces Runtime in both primary navigation surfaces while keeping diagnostics accessible", async () => {
    const source = await readFile(rendererUrl, "utf8");
    expect(source).toContain('{ key: "skills", label: "Skills" }');
    expect(source).not.toContain('{ key: "runtime", label: "Runtime" }');
    expect(source).toContain('onClick={() => toggleDrawer("skills")}');
    expect(source).toContain("<span>Skills</span>");
    expect(source).toContain("Runtime & Diagnostics");
    expect(source).toContain(
      "<SkillManager workspaceKey={status?.activeWorkspace} />",
    );
  });

  it("uses explicit import scope confirmation and shared trigger portals", async () => {
    const source = await readFile(skillUrl, "utf8");
    expect(source).toContain("＋ Add Skill");
    expect(source).toContain("Import File / ZIP");
    expect(source).toContain("Import Folder");
    expect(source).toContain("Discover skills.sh");
    expect(source).toContain('action: "skills_search_remote"');
    expect(source).toContain('action: "skill_install_remote"');
    expect(source).toContain(
      'setPendingImport({ sourcePath, kind, scope: "workspace" })',
    );
    expect(source).toContain("const confirmImport = async");
    expect(source).not.toContain("OK = Workspace");
    expect(source).toContain("const triggerModal = triggerOpen");
    expect(source).toContain("{triggerModal}");
    expect(source).toContain("useModalFocusTrap");
  });

  it("persists editor drafts and distinguishes zero matcher results", async () => {
    const source = await readFile(skillUrl, "utf8");
    expect(source).toContain("window.sessionStorage.setItem");
    expect(source).toContain("skillDraftKey(workspaceKey)");
    expect(source).toContain("setTriggerHasRun(true)");
    expect(source).toContain(
      "No matching skills. Try a more specific task description.",
    );
  });

  it("keeps Skill Manager text readable and its list scrollable", async () => {
    const css = await readFile(cssUrl, "utf8");
    expect(css).toMatch(/\.skill-row-name strong \{[\s\S]*?font-size:\s*12px;/);
    expect(css).toMatch(
      /\.skill-row-description \{[\s\S]*?font-size:\s*10\.5px;/,
    );
    expect(css).toMatch(/\.skills-search input \{[\s\S]*?11\.5px/);
    expect(css).toMatch(/\.skills-scroll \{[\s\S]*?overflow-y:\s*auto;/);
  });
});
