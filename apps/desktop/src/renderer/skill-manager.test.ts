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
    expect(source).toContain("<SkillManager />");
  });

  it("uses one Add Skill menu for create and import flows", async () => {
    const source = await readFile(skillUrl, "utf8");
    expect(source).toContain("＋ Add Skill");
    expect(source).toContain("Create Skill");
    expect(source).toContain("Import File / ZIP");
    expect(source).toContain("Import Folder");
    expect(source).toContain("Duplicate Existing");
    expect(source).toContain("Test Trigger");
    expect(source).toContain("createPortal(");
    expect(source).toContain("document.body");
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
