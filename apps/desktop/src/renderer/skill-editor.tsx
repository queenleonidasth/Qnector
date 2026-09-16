import type { Dispatch, SetStateAction } from "react";

export interface SkillForm {
  scope: "user" | "workspace";
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

export function SkillEditor({
  editor,
  form,
  setForm,
  busy,
  error,
  onCancel,
  onSave,
}: {
  editor: "create" | "edit";
  form: SkillForm;
  setForm: Dispatch<SetStateAction<SkillForm>>;
  busy: boolean;
  error?: string;
  onCancel: () => void;
  onSave: () => void;
}): React.ReactElement {
  return (
    <div className="skills-page skills-editor-page">
      <div className="skills-subhead">
        <button
          className="skills-back"
          type="button"
          onClick={() => onCancel()}
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
            Guided metadata plus Markdown instructions. Qnector validates before
            saving.
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
                  scope: e.target.value as SkillForm["scope"],
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
                name: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
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
          onClick={() => onCancel()}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="button"
          className="skills-primary"
          onClick={onSave}
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
