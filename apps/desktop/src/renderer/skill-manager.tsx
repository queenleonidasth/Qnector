import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { ToolResult } from "../preload/api.js";
import "./skill-manager.css";

type SkillScope = "user" | "workspace";
type SkillFilter =
  "all" | "bundled" | "user" | "workspace" | "active" | "disabled";

interface SkillSummary {
  name: string;
  description: string;
  path: string;
  directory: string;
  source: string;
  license?: string;
  compatibility?: string;
  allowedTools?: string[];
  enabled: boolean;
}

interface SkillDocument extends SkillSummary {
  instructions: string;
  bytes: number;
}

interface SkillStatus {
  roots: Array<{ path: string; source: string; available: boolean }>;
  skillCount: number;
  activeCount: number;
  disabledCount: number;
  skills: SkillSummary[];
}

interface SkillValidation {
  name: string;
  healthy: boolean;
  checks: Array<{
    name: string;
    status: "pass" | "warn" | "fail";
    detail: string;
  }>;
}

interface SkillForm {
  scope: SkillScope;
  name: string;
  description: string;
  instructions: string;
  license: string;
  compatibility: string;
  allowedTools: string[];
}

const TOOL_NAMES = [
  "system",
  "workspace",
  "files",
  "process",
  "git",
  "memory",
  "browser",
  "computer",
] as const;

const emptyForm = (): SkillForm => ({
  scope: "user",
  name: "",
  description: "",
  instructions:
    "# Skill instructions\n\nDescribe the workflow, rules, and done gate here.",
  license: "MIT",
  compatibility: "Qnector 0.4.11+",
  allowedTools: ["system", "workspace", "files", "process"],
});

function unwrap<T>(result: ToolResult): T {
  if (!result.ok) throw new Error(result.error?.message ?? result.summary);
  const outer = result.data as { data?: unknown } | undefined;
  return (outer?.data ?? outer) as T;
}

async function system(input: Record<string, unknown>): Promise<ToolResult> {
  return window.qnector.callTool("system", input);
}

export function SkillManager(): React.ReactElement {
  const [status, setStatus] = useState<SkillStatus>();
  const [filter, setFilter] = useState<SkillFilter>("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [addOpen, setAddOpen] = useState(false);
  const [detail, setDetail] = useState<SkillDocument>();
  const [validation, setValidation] = useState<SkillValidation>();
  const [editor, setEditor] = useState<"create" | "edit">();
  const [form, setForm] = useState<SkillForm>(emptyForm);
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [triggerQuery, setTriggerQuery] = useState("");
  const [triggerMatches, setTriggerMatches] = useState<SkillSummary[]>([]);
  const [duplicateOpen, setDuplicateOpen] = useState(false);

  const refresh = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      setStatus(unwrap<SkillStatus>(await system({ action: "skills_status" })));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const skills = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (status?.skills ?? []).filter((skill) => {
      if (filter === "bundled" && skill.source !== "bundled") return false;
      if (filter === "user" && skill.source !== "user") return false;
      if (filter === "workspace" && skill.source !== "workspace") return false;
      if (filter === "active" && !skill.enabled) return false;
      if (filter === "disabled" && skill.enabled) return false;
      if (!normalized) return true;
      return `${skill.name}\n${skill.description}\n${skill.allowedTools?.join(" ") ?? ""}\n${skill.source}`
        .toLowerCase()
        .includes(normalized);
    });
  }, [filter, query, status]);

  const openSkill = async (name: string): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      const [skillResult, validationResult] = await Promise.all([
        system({ action: "skill_get", name }),
        system({ action: "skill_validate", name }),
      ]);
      setDetail(unwrap<SkillDocument>(skillResult));
      setValidation(unwrap<SkillValidation>(validationResult));
      setAddOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const startCreate = (): void => {
    setForm(emptyForm());
    setEditor("create");
    setDetail(undefined);
    setAddOpen(false);
  };

  const startEdit = (): void => {
    if (!detail) return;
    setForm({
      scope: detail.source === "workspace" ? "workspace" : "user",
      name: detail.name,
      description: detail.description,
      instructions: detail.instructions,
      license: detail.license ?? "",
      compatibility: detail.compatibility ?? "",
      allowedTools: [...(detail.allowedTools ?? [])],
    });
    setEditor("edit");
  };

  const saveSkill = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      const input = {
        action: editor === "edit" ? "skill_update" : "skill_create",
        scope: form.scope,
        name: form.name.trim(),
        description: form.description.trim(),
        instructions: form.instructions,
        license: form.license.trim(),
        compatibility: form.compatibility.trim(),
        allowedTools: form.allowedTools,
      };
      const saved = unwrap<SkillDocument>(await system(input));
      setEditor(undefined);
      await refresh();
      await openSkill(saved.name);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  };

  const importSkill = async (kind: "file" | "folder"): Promise<void> => {
    setAddOpen(false);
    const sourcePath = await window.qnector.chooseSkillImport(kind);
    if (!sourcePath) return;
    const scope = window.confirm(
      "Import only for this workspace?\n\nOK = Workspace\nCancel = User (all workspaces)",
    )
      ? "workspace"
      : "user";
    setBusy(true);
    setError(undefined);
    try {
      const imported = unwrap<SkillDocument>(
        await system({ action: "skill_import", sourcePath, scope }),
      );
      await refresh();
      await openSkill(imported.name);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  };

  const duplicateSkill = async (
    skill: SkillSummary,
    scope: SkillScope,
    customize = false,
  ): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      const duplicated = unwrap<SkillDocument>(
        await system({
          action: "skill_duplicate",
          name: skill.name,
          scope,
          ...(customize ? {} : { newName: `${skill.name}-copy` }),
        }),
      );
      setDuplicateOpen(false);
      await refresh();
      await openSkill(duplicated.name);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  };

  const toggleSkill = async (): Promise<void> => {
    if (!detail) return;
    setBusy(true);
    setError(undefined);
    try {
      await system({
        action: "skill_enable",
        name: detail.name,
        enabled: !detail.enabled,
      });
      await refresh();
      await openSkill(detail.name);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  };

  const deleteSkill = async (): Promise<void> => {
    if (!detail || !["user", "workspace"].includes(detail.source)) return;
    if (
      !window.confirm(`Delete '${detail.name}'? This removes its skill folder.`)
    )
      return;
    setBusy(true);
    setError(undefined);
    try {
      await system({ action: "skill_delete", name: detail.name });
      setDetail(undefined);
      setValidation(undefined);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  };

  const testTrigger = async (): Promise<void> => {
    if (!triggerQuery.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = unwrap<{ skills: SkillSummary[] }>(
        await system({
          action: "skills_match",
          query: triggerQuery.trim(),
          maxResults: 5,
        }),
      );
      setTriggerMatches(result.skills);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  if (editor) {
    return (
      <div className="skills-page skills-editor-page">
        <div className="skills-subhead">
          <button
            className="skills-back"
            type="button"
            onClick={() => setEditor(undefined)}
          >
            ‹ Skills
          </button>
          <span className="skills-state-pill">
            {editor === "edit" ? "EDIT" : "NEW"}
          </span>
        </div>
        <div className="skills-scroll skills-editor-scroll">
          <div className="skills-editor-heading">
            <h2>{editor === "edit" ? `Edit ${form.name}` : "Create Skill"}</h2>
            <p>
              Guided metadata plus Markdown instructions. Qnector validates
              before saving.
            </p>
          </div>
          {editor === "create" && (
            <label className="skill-field">
              <span>Scope</span>
              <select
                value={form.scope}
                onChange={(e) =>
                  setForm((v) => ({
                    ...v,
                    scope: e.target.value as SkillScope,
                  }))
                }
              >
                <option value="user">User · all workspaces</option>
                <option value="workspace">
                  Workspace · current project only
                </option>
              </select>
            </label>
          )}
          <label className="skill-field">
            <span>Name</span>
            <input
              value={form.name}
              disabled={editor === "edit"}
              placeholder="my-skill"
              onChange={(e) =>
                setForm((v) => ({
                  ...v,
                  name: e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9-]/g, "-"),
                }))
              }
            />
          </label>
          <label className="skill-field">
            <span>Description / trigger wording</span>
            <textarea
              rows={4}
              value={form.description}
              onChange={(e) =>
                setForm((v) => ({ ...v, description: e.target.value }))
              }
              placeholder="What should this skill help with, and which phrases should trigger it?"
            />
          </label>
          <div className="skill-field">
            <span>Allowed tools</span>
            <div className="skill-tool-grid">
              {TOOL_NAMES.map((tool) => (
                <label
                  key={tool}
                  className={form.allowedTools.includes(tool) ? "selected" : ""}
                >
                  <input
                    type="checkbox"
                    checked={form.allowedTools.includes(tool)}
                    onChange={() =>
                      setForm((v) => ({
                        ...v,
                        allowedTools: v.allowedTools.includes(tool)
                          ? v.allowedTools.filter((entry) => entry !== tool)
                          : [...v.allowedTools, tool],
                      }))
                    }
                  />
                  {tool}
                </label>
              ))}
            </div>
          </div>
          <div className="skill-field-row">
            <label className="skill-field">
              <span>License</span>
              <input
                value={form.license}
                onChange={(e) =>
                  setForm((v) => ({ ...v, license: e.target.value }))
                }
              />
            </label>
            <label className="skill-field">
              <span>Compatibility</span>
              <input
                value={form.compatibility}
                onChange={(e) =>
                  setForm((v) => ({ ...v, compatibility: e.target.value }))
                }
              />
            </label>
          </div>
          <label className="skill-field skill-instructions-field">
            <span>Instructions · Markdown</span>
            <textarea
              value={form.instructions}
              onChange={(e) =>
                setForm((v) => ({ ...v, instructions: e.target.value }))
              }
            />
          </label>
          {error && <div className="skills-error">{error}</div>}
        </div>
        <div className="skills-sticky-actions">
          <button
            type="button"
            className="skills-secondary"
            onClick={() => setEditor(undefined)}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="skills-primary"
            onClick={() => void saveSkill()}
            disabled={
              busy ||
              !form.name.trim() ||
              !form.description.trim() ||
              !form.instructions.trim()
            }
          >
            {busy ? "Saving…" : "Validate & Save"}
          </button>
        </div>
      </div>
    );
  }

  if (detail) {
    const writable = detail.source === "user" || detail.source === "workspace";
    return (
      <div className="skills-page skills-detail-page">
        <div className="skills-subhead">
          <button
            className="skills-back"
            type="button"
            onClick={() => {
              setDetail(undefined);
              setValidation(undefined);
            }}
          >
            ‹ Skills
          </button>
          <button
            className={`skill-toggle ${detail.enabled ? "on" : ""}`}
            type="button"
            onClick={() => void toggleSkill()}
            disabled={busy}
            aria-label={detail.enabled ? "Disable skill" : "Enable skill"}
          >
            <span />
          </button>
        </div>
        <div className="skills-scroll">
          <div className="skill-detail-hero">
            <div className="skill-detail-icon">{initials(detail.name)}</div>
            <div>
              <h2>{detail.name}</h2>
              <div className="skill-badges">
                <span>{detail.source.toUpperCase()}</span>
                <span className={detail.enabled ? "healthy" : "disabled"}>
                  {detail.enabled ? "Active" : "Disabled"}
                </span>
              </div>
            </div>
          </div>
          <p className="skill-detail-description">{detail.description}</p>
          <div className="skill-detail-actions">
            {writable ? (
              <button
                className="skills-primary"
                type="button"
                onClick={startEdit}
              >
                Edit Skill
              </button>
            ) : (
              <button
                className="skills-primary"
                type="button"
                onClick={() => void duplicateSkill(detail, "user", true)}
                disabled={busy}
              >
                Customize
              </button>
            )}
            <button
              className="skills-secondary"
              type="button"
              onClick={() => {
                setTriggerOpen(true);
                setTriggerQuery(detail.name);
              }}
            >
              Test Trigger
            </button>
          </div>
          {!writable && (
            <div className="skill-readonly-note">
              Bundled skills are read-only. Customize creates a User override,
              so app updates do not overwrite your changes.
            </div>
          )}
          <section className="skill-detail-section">
            <h3>Allowed tools</h3>
            <div className="skill-tool-chips">
              {(detail.allowedTools ?? []).map((tool) => (
                <span key={tool}>{tool}</span>
              ))}
              {(detail.allowedTools?.length ?? 0) === 0 && (
                <span>None declared</span>
              )}
            </div>
          </section>
          <section className="skill-detail-section">
            <h3>Instructions</h3>
            <pre className="skill-markdown-preview">{detail.instructions}</pre>
          </section>
          <section className="skill-detail-section">
            <h3>Validation</h3>
            <div className="skill-validation-list">
              {validation?.checks.map((check) => (
                <div
                  key={check.name}
                  className={`skill-validation-row ${check.status}`}
                >
                  <span className="skill-validation-dot" />
                  <div>
                    <strong>{check.name}</strong>
                    <small>{check.detail}</small>
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className="skill-detail-section skill-detail-meta">
            <h3>Details</h3>
            <div>
              <span>License</span>
              <strong>{detail.license ?? "—"}</strong>
            </div>
            <div>
              <span>Compatibility</span>
              <strong>{detail.compatibility ?? "—"}</strong>
            </div>
            <div>
              <span>Location</span>
              <strong title={detail.path}>{detail.path}</strong>
            </div>
          </section>
          {writable && (
            <button
              className="skills-danger"
              type="button"
              onClick={() => void deleteSkill()}
              disabled={busy}
            >
              Delete Skill
            </button>
          )}
          {error && <div className="skills-error">{error}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="skills-page">
      <div className="skills-home-head">
        <div>
          <h2>SKILL MANAGER</h2>
          <p>
            <strong>{status?.skillCount ?? 0} skills</strong> ·{" "}
            {status?.activeCount ?? 0} active · {status?.disabledCount ?? 0}{" "}
            disabled
          </p>
        </div>
        <div className="skills-add-wrap">
          <button
            type="button"
            className="skills-add"
            onClick={() => setAddOpen((value) => !value)}
          >
            ＋ Add Skill <span>⌄</span>
          </button>
          {addOpen && (
            <div className="skills-add-menu">
              <button type="button" onClick={startCreate}>
                <strong>Create Skill</strong>
                <small>Start from a guided template</small>
              </button>
              <button type="button" onClick={() => void importSkill("file")}>
                <strong>Import File / ZIP</strong>
                <small>SKILL.md or packaged skill</small>
              </button>
              <button type="button" onClick={() => void importSkill("folder")}>
                <strong>Import Folder</strong>
                <small>Existing skill directory</small>
              </button>
              <button
                type="button"
                onClick={() => {
                  setDuplicateOpen(true);
                  setAddOpen(false);
                }}
              >
                <strong>Duplicate Existing</strong>
                <small>Use an installed skill as a base</small>
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="skills-controls">
        <label className="skills-search">
          <span>⌕</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search skills, tools or triggers…"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")}>
              ×
            </button>
          )}
        </label>
        <div className="skills-filters">
          {(
            [
              "all",
              "bundled",
              "user",
              "workspace",
              "active",
              "disabled",
            ] as SkillFilter[]
          ).map((item) => (
            <button
              type="button"
              key={item}
              className={filter === item ? "active" : ""}
              onClick={() => setFilter(item)}
            >
              {item === "all" ? "All" : item[0]!.toUpperCase() + item.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="skills-scroll skills-list" data-testid="skills-scroll">
        {busy && !status && (
          <div className="skills-empty">Loading Agent Skills…</div>
        )}
        {skills.map((skill) => (
          <button
            type="button"
            className={`skill-row ${skill.enabled ? "" : "is-disabled"}`}
            key={`${skill.source}-${skill.name}`}
            onClick={() => void openSkill(skill.name)}
          >
            <span className="skill-row-icon">{initials(skill.name)}</span>
            <span className="skill-row-main">
              <span className="skill-row-name">
                <strong>{skill.name}</strong>
                <em>{skill.source.toUpperCase()}</em>
              </span>
              <span className="skill-row-description">{skill.description}</span>
              <span className="skill-row-meta">
                {skill.allowedTools?.length ?? 0} tools ·{" "}
                {skill.license ?? "No license"} ·{" "}
                <b>{skill.enabled ? "Healthy" : "Disabled"}</b>
              </span>
            </span>
            <span className="skill-row-arrow">›</span>
          </button>
        ))}
        {!busy && skills.length === 0 && (
          <div className="skills-empty">
            <strong>No skills found</strong>
            <span>Try another filter or add a new skill.</span>
          </div>
        )}
        {error && <div className="skills-error">{error}</div>}
      </div>
      <div className="skills-footer">
        <span>
          <i /> Skill runtime ready
        </span>
        <button type="button" onClick={() => setTriggerOpen(true)}>
          ⌁ Test Trigger
        </button>
      </div>

      {triggerOpen &&
        createPortal(
          <div
            className="skills-modal-backdrop"
            onClick={() => setTriggerOpen(false)}
          >
            <section
              className="skills-modal"
              role="dialog"
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="skills-modal-head">
                <div>
                  <strong>Test Trigger</strong>
                  <small>See which active skills Qnector would match.</small>
                </div>
                <button type="button" onClick={() => setTriggerOpen(false)}>
                  ×
                </button>
              </div>
              <label className="skill-field">
                <span>Prompt or task</span>
                <textarea
                  rows={4}
                  value={triggerQuery}
                  onChange={(e) => setTriggerQuery(e.target.value)}
                  placeholder="ช่วยออกแบบหน้า settings ให้ใช้ง่ายขึ้น"
                />
              </label>
              <button
                className="skills-primary skills-test-button"
                type="button"
                onClick={() => void testTrigger()}
                disabled={busy || !triggerQuery.trim()}
              >
                {busy ? "Testing…" : "Run Matcher"}
              </button>
              <div className="trigger-results">
                {triggerMatches.map((skill, index) => (
                  <button
                    type="button"
                    key={skill.name}
                    onClick={() => {
                      setTriggerOpen(false);
                      void openSkill(skill.name);
                    }}
                  >
                    <span>{index + 1}</span>
                    <div>
                      <strong>{skill.name}</strong>
                      <small>
                        {index === 0 ? "Best match" : skill.description}
                      </small>
                    </div>
                    <em>›</em>
                  </button>
                ))}
                {triggerMatches.length === 0 && (
                  <p>Run the matcher to see ranked results.</p>
                )}
              </div>
            </section>
          </div>,
          document.body,
        )}

      {duplicateOpen &&
        createPortal(
          <div
            className="skills-modal-backdrop"
            onClick={() => setDuplicateOpen(false)}
          >
            <section
              className="skills-modal duplicate-modal"
              role="dialog"
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="skills-modal-head">
                <div>
                  <strong>Duplicate Existing</strong>
                  <small>Creates a User copy named &lt;skill&gt;-copy.</small>
                </div>
                <button type="button" onClick={() => setDuplicateOpen(false)}>
                  ×
                </button>
              </div>
              <div className="duplicate-list">
                {(status?.skills ?? []).map((skill) => (
                  <button
                    type="button"
                    key={skill.name}
                    onClick={() => void duplicateSkill(skill, "user")}
                  >
                    <span className="skill-row-icon">
                      {initials(skill.name)}
                    </span>
                    <div>
                      <strong>{skill.name}</strong>
                      <small>{skill.source}</small>
                    </div>
                    <em>＋</em>
                  </button>
                ))}
              </div>
            </section>
          </div>,
          document.body,
        )}
    </div>
  );
}

function initials(name: string): string {
  return (
    name
      .split("-")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "SK"
  );
}
