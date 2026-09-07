import AdmZip from "adm-zip";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const MAX_SKILL_BYTES = 256 * 1024;
const MAX_SKILLS = 500;
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KNOWN_TOOLS = new Set([
  "system",
  "workspace",
  "files",
  "process",
  "git",
  "memory",
  "browser",
  "computer",
]);

export interface AgentSkillRoot {
  path: string;
  source: string;
}

export interface AgentSkillSummary {
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

export interface AgentSkillDocument extends AgentSkillSummary {
  instructions: string;
  bytes: number;
}

export interface AgentSkillStatus {
  roots: Array<AgentSkillRoot & { available: boolean }>;
  skillCount: number;
  activeCount: number;
  disabledCount: number;
  skills: AgentSkillSummary[];
}

export interface AgentSkillServiceOptions {
  roots?: AgentSkillRoot[];
  workspaceRoot?: () => string | undefined;
}

export interface AgentSkillWriteInput {
  scope: "user" | "workspace";
  name: string;
  description: string;
  instructions: string;
  license?: string;
  compatibility?: string;
  allowedTools?: string[];
}

interface SkillStateFile {
  disabled?: string[];
}

export class AgentSkillService {
  public constructor(private readonly options: AgentSkillServiceOptions = {}) {}

  public async status(): Promise<AgentSkillStatus> {
    const roots = this.roots();
    const rootStatus = await Promise.all(
      roots.map(async (root) => ({
        ...root,
        available: await isDirectory(root.path),
      })),
    );
    const skills = await this.discover(true);
    const activeCount = skills.filter((skill) => skill.enabled).length;
    return {
      roots: rootStatus,
      skillCount: skills.length,
      activeCount,
      disabledCount: skills.length - activeCount,
      skills,
    };
  }

  public async list(
    input: { query?: string; limit?: number; includeDisabled?: boolean } = {},
  ): Promise<AgentSkillSummary[]> {
    const discovered = await this.discover(input.includeDisabled === true);
    const query = input.query?.trim().toLowerCase();
    const filtered = query
      ? discovered.filter((skill) =>
          `${skill.name}\n${skill.description}\n${skill.allowedTools?.join(" ") ?? ""}\n${skill.source}`
            .toLowerCase()
            .includes(query),
        )
      : discovered;
    return filtered.slice(0, clamp(input.limit ?? 100, 1, MAX_SKILLS));
  }

  public async match(query: string, limit = 5): Promise<AgentSkillSummary[]> {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    const terms = tokenize(normalized);
    const scored = (await this.discover(false))
      .map((skill) => ({
        skill,
        score: scoreSkill(skill, normalized, terms),
      }))
      .filter((entry) => entry.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.skill.name.localeCompare(b.skill.name, "en", {
            sensitivity: "base",
          }),
      );
    return scored.slice(0, clamp(limit, 1, 20)).map((entry) => entry.skill);
  }

  public async get(
    name: string,
    options: { includeDisabled?: boolean } = {},
  ): Promise<AgentSkillDocument> {
    const requested = name.trim().toLowerCase();
    if (!requested) throw new Error("INVALID_INPUT: skill name is required");
    const summary = (
      await this.discover(options.includeDisabled === true)
    ).find((entry) => entry.name.toLowerCase() === requested);
    if (!summary) throw new Error(`SKILL_NOT_FOUND: ${name}`);
    const info = await stat(summary.path);
    if (info.size > MAX_SKILL_BYTES)
      throw new Error(
        `SKILL_TOO_LARGE: ${summary.name} exceeds ${MAX_SKILL_BYTES} bytes`,
      );
    const parsed = parseSkill(
      await readFile(summary.path, "utf8"),
      summary.path,
    );
    return {
      ...summary,
      instructions: parsed.body,
      bytes: info.size,
    };
  }

  public async create(
    input: AgentSkillWriteInput,
  ): Promise<AgentSkillDocument> {
    validateWriteInput(input);
    const root = this.writableRoot(input.scope);
    await mkdir(root.path, { recursive: true });
    const directory = path.join(root.path, input.name);
    if (await isDirectory(directory))
      throw new Error(
        `SKILL_EXISTS: ${input.name} already exists in ${input.scope}`,
      );
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "SKILL.md"),
      serializeSkill(input),
      "utf8",
    );
    await this.setEnabled(input.name, true);
    return this.get(input.name, { includeDisabled: true });
  }

  public async update(
    name: string,
    input: Omit<AgentSkillWriteInput, "scope">,
  ): Promise<AgentSkillDocument> {
    const current = await this.get(name, { includeDisabled: true });
    if (!isWritableSource(current.source))
      throw new Error(
        `SKILL_READ_ONLY: ${current.name} is ${current.source}; customize it into User or Workspace scope first`,
      );
    const next: AgentSkillWriteInput = {
      scope: current.source as "user" | "workspace",
      ...input,
    };
    validateWriteInput(next);
    if (next.name !== current.name)
      throw new Error(
        "INVALID_INPUT: renaming a skill is not supported; duplicate it instead",
      );
    await writeFile(current.path, serializeSkill(next), "utf8");
    return this.get(current.name, { includeDisabled: true });
  }

  public async remove(name: string): Promise<void> {
    const current = await this.get(name, { includeDisabled: true });
    if (!isWritableSource(current.source))
      throw new Error(`SKILL_READ_ONLY: ${current.name} cannot be deleted`);
    await rm(current.directory, { recursive: true, force: true });
    await this.setEnabled(current.name, true);
  }

  public async setEnabled(name: string, enabled: boolean): Promise<void> {
    const normalized = name.trim().toLowerCase();
    if (!normalized) throw new Error("INVALID_INPUT: skill name is required");
    const state = await this.readState();
    const disabled = new Set(
      (state.disabled ?? []).map((entry) => entry.toLowerCase()),
    );
    if (enabled) disabled.delete(normalized);
    else disabled.add(normalized);
    await this.writeState({ disabled: [...disabled].sort() });
  }

  public async duplicate(
    name: string,
    scope: "user" | "workspace",
    newName?: string,
  ): Promise<AgentSkillDocument> {
    const source = await this.get(name, { includeDisabled: true });
    const targetName = newName?.trim() || source.name;
    return this.create({
      scope,
      name: targetName,
      description: source.description,
      instructions: source.instructions,
      ...(source.license ? { license: source.license } : {}),
      ...(source.compatibility ? { compatibility: source.compatibility } : {}),
      ...(source.allowedTools ? { allowedTools: source.allowedTools } : {}),
    });
  }

  public async importSkill(
    sourcePath: string,
    scope: "user" | "workspace",
  ): Promise<AgentSkillDocument> {
    const absolute = path.resolve(sourcePath);
    const root = this.writableRoot(scope);
    await mkdir(root.path, { recursive: true });
    const info = await stat(absolute).catch(() => undefined);
    if (!info) throw new Error(`SKILL_IMPORT_NOT_FOUND: ${absolute}`);

    if (info.isDirectory()) {
      const skillFile = path.join(absolute, "SKILL.md");
      const parsed = parseSkill(await readFile(skillFile, "utf8"), skillFile);
      const name = parsed.frontmatter.name!.trim();
      validateSkillName(name);
      const destination = path.join(root.path, name);
      if (await isDirectory(destination))
        throw new Error(`SKILL_EXISTS: ${name}`);
      await cp(absolute, destination, {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      await this.setEnabled(name, true);
      return this.get(name, { includeDisabled: true });
    }

    if (path.basename(absolute).toLowerCase() === "skill.md") {
      const raw = await readFile(absolute, "utf8");
      const parsed = parseSkill(raw, absolute);
      const name = parsed.frontmatter.name!.trim();
      validateSkillName(name);
      const destination = path.join(root.path, name);
      if (await isDirectory(destination))
        throw new Error(`SKILL_EXISTS: ${name}`);
      await mkdir(destination, { recursive: true });
      await writeFile(path.join(destination, "SKILL.md"), raw, "utf8");
      await this.setEnabled(name, true);
      return this.get(name, { includeDisabled: true });
    }

    if (path.extname(absolute).toLowerCase() === ".zip") {
      return this.importZip(absolute, root);
    }

    throw new Error(
      "SKILL_IMPORT_UNSUPPORTED: choose SKILL.md, a skill folder, or a ZIP archive",
    );
  }

  public async validate(name: string): Promise<{
    healthy: boolean;
    checks: Array<{
      name: string;
      status: "pass" | "warn" | "fail";
      detail: string;
    }>;
  }> {
    const skill = await this.get(name, { includeDisabled: true });
    const checks: Array<{
      name: string;
      status: "pass" | "warn" | "fail";
      detail: string;
    }> = [];
    const add = (
      name: string,
      status: "pass" | "warn" | "fail",
      detail: string,
    ) => checks.push({ name, status, detail });
    add("skill-file", "pass", skill.path);
    add(
      "name",
      SKILL_NAME_PATTERN.test(skill.name) ? "pass" : "fail",
      skill.name,
    );
    add(
      "directory",
      path.basename(skill.directory).toLowerCase() === skill.name.toLowerCase()
        ? "pass"
        : "warn",
      path.basename(skill.directory),
    );
    add(
      "description",
      skill.description.trim() ? "pass" : "fail",
      `${skill.description.length} characters`,
    );
    add(
      "size",
      skill.bytes <= MAX_SKILL_BYTES ? "pass" : "fail",
      `${skill.bytes} / ${MAX_SKILL_BYTES} bytes`,
    );
    const unknownTools = (skill.allowedTools ?? []).filter(
      (tool) => !KNOWN_TOOLS.has(tool),
    );
    add(
      "allowed-tools",
      unknownTools.length === 0 ? "pass" : "warn",
      unknownTools.length === 0
        ? `${skill.allowedTools?.length ?? 0} recognized tool(s)`
        : `Unknown: ${unknownTools.join(", ")}`,
    );
    add(
      "state",
      skill.enabled ? "pass" : "warn",
      skill.enabled ? "Active" : "Disabled",
    );
    return {
      healthy: !checks.some((check) => check.status === "fail"),
      checks,
    };
  }

  private async importZip(
    archive: string,
    root: AgentSkillRoot,
  ): Promise<AgentSkillDocument> {
    const zip = new AdmZip(archive);
    const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
    const skillEntry = entries.find((entry) =>
      /(^|\/)SKILL\.md$/i.test(entry.entryName),
    );
    if (!skillEntry)
      throw new Error("SKILL_IMPORT_INVALID: ZIP does not contain SKILL.md");
    const raw = skillEntry.getData().toString("utf8");
    const parsed = parseSkill(raw, `${archive}:${skillEntry.entryName}`);
    const name = parsed.frontmatter.name!.trim();
    validateSkillName(name);
    const destination = path.join(root.path, name);
    if (await isDirectory(destination))
      throw new Error(`SKILL_EXISTS: ${name}`);
    await mkdir(destination, { recursive: true });
    const prefix = skillEntry.entryName.slice(0, -"SKILL.md".length);
    for (const entry of entries) {
      if (!entry.entryName.startsWith(prefix)) continue;
      const relative = entry.entryName.slice(prefix.length).replace(/\\/g, "/");
      if (
        !relative ||
        relative.startsWith("/") ||
        relative.split("/").includes("..")
      )
        continue;
      const target = path.resolve(destination, relative);
      if (!isWithin(destination, target)) continue;
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, entry.getData());
    }
    await this.setEnabled(name, true);
    return this.get(name, { includeDisabled: true });
  }

  private roots(): AgentSkillRoot[] {
    const roots = [...(this.options.roots ?? [])];
    const workspace = this.options.workspaceRoot?.();
    if (workspace?.trim()) {
      roots.push({
        path: path.join(path.resolve(workspace), ".qnector", "skills"),
        source: "workspace",
      });
    }
    const seen = new Set<string>();
    return roots.filter((root) => {
      const absolute = path.resolve(root.path);
      const key =
        process.platform === "win32" ? absolute.toLowerCase() : absolute;
      if (seen.has(key)) return false;
      seen.add(key);
      root.path = absolute;
      return true;
    });
  }

  private writableRoot(scope: "user" | "workspace"): AgentSkillRoot {
    const root = this.roots().find((entry) => entry.source === scope);
    if (!root)
      throw new Error(
        scope === "workspace"
          ? "SKILL_SCOPE_UNAVAILABLE: choose an active workspace first"
          : "SKILL_SCOPE_UNAVAILABLE: user skill root is not configured",
      );
    return root;
  }

  private statePath(): string {
    const userRoot = this.roots().find((entry) => entry.source === "user");
    if (userRoot)
      return path.join(path.dirname(userRoot.path), "skill-state.json");
    const workspace = this.options.workspaceRoot?.();
    if (workspace?.trim())
      return path.join(path.resolve(workspace), ".qnector", "skill-state.json");
    return path.join(process.cwd(), ".qnector", "skill-state.json");
  }

  private async readState(): Promise<SkillStateFile> {
    try {
      const parsed = JSON.parse(
        await readFile(this.statePath(), "utf8"),
      ) as SkillStateFile;
      return {
        disabled: Array.isArray(parsed.disabled)
          ? parsed.disabled.filter((v): v is string => typeof v === "string")
          : [],
      };
    } catch {
      return { disabled: [] };
    }
  }

  private async writeState(state: SkillStateFile): Promise<void> {
    const file = this.statePath();
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  private async discover(
    includeDisabled: boolean,
  ): Promise<AgentSkillSummary[]> {
    const disabled = new Set(
      ((await this.readState()).disabled ?? []).map((entry) =>
        entry.toLowerCase(),
      ),
    );
    const byName = new Map<string, AgentSkillSummary>();
    for (const root of this.roots()) {
      if (!(await isDirectory(root.path))) continue;
      const candidates: string[] = [];
      if (await isFile(path.join(root.path, "SKILL.md")))
        candidates.push(root.path);
      const entries = await readdir(root.path, { withFileTypes: true }).catch(
        () => [],
      );
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const directory = path.join(root.path, entry.name);
        if (await isFile(path.join(directory, "SKILL.md")))
          candidates.push(directory);
      }
      for (const directory of candidates) {
        if (byName.size >= MAX_SKILLS) break;
        const file = path.join(directory, "SKILL.md");
        try {
          const info = await stat(file);
          if (info.size <= 0 || info.size > MAX_SKILL_BYTES) continue;
          const parsed = parseSkill(await readFile(file, "utf8"), file);
          const name = parsed.frontmatter.name?.trim();
          const description = parsed.frontmatter.description?.trim();
          if (!name || !description) continue;
          const key = name.toLowerCase();
          const enabled = !disabled.has(key);
          byName.set(key, {
            name,
            description,
            path: file,
            directory,
            source: root.source,
            enabled,
            ...(parsed.frontmatter.license
              ? { license: parsed.frontmatter.license }
              : {}),
            ...(parsed.frontmatter.compatibility
              ? { compatibility: parsed.frontmatter.compatibility }
              : {}),
            ...(parsed.frontmatter.allowedTools?.length
              ? { allowedTools: parsed.frontmatter.allowedTools }
              : {}),
          });
        } catch {
          // A malformed skill must never prevent Qnector from loading other skills.
        }
      }
    }
    return [...byName.values()]
      .filter((skill) => includeDisabled || skill.enabled)
      .sort((a, b) =>
        a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
      );
  }
}

type ParsedSkill = {
  frontmatter: {
    name?: string;
    description?: string;
    license?: string;
    compatibility?: string;
    allowedTools?: string[];
  };
  body: string;
};

function parseSkill(content: string, file: string): ParsedSkill {
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n"))
    throw new Error(`SKILL_INVALID: ${file} is missing YAML frontmatter`);
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0)
    throw new Error(`SKILL_INVALID: ${file} has unterminated YAML frontmatter`);
  const yaml = normalized.slice(4, end);
  const body = normalized.slice(end + 5).trim();
  const frontmatter: ParsedSkill["frontmatter"] = {};
  for (const rawLine of yaml.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = unquote(line.slice(separator + 1).trim());
    if (key === "name") frontmatter.name = value;
    else if (key === "description") frontmatter.description = value;
    else if (key === "license") frontmatter.license = value;
    else if (key === "compatibility") frontmatter.compatibility = value;
    else if (key === "allowed-tools" || key === "allowed_tools") {
      frontmatter.allowedTools = value
        .replace(/^\[/, "")
        .replace(/\]$/, "")
        .split(/[ ,]+/)
        .map((entry) => unquote(entry.trim()))
        .filter(Boolean);
    }
  }
  if (!frontmatter.name || !frontmatter.description)
    throw new Error(`SKILL_INVALID: ${file} requires name and description`);
  return { frontmatter, body };
}

function serializeSkill(input: AgentSkillWriteInput): string {
  const lines = [
    "---",
    `name: ${input.name}`,
    `description: ${yamlValue(input.description)}`,
  ];
  if (input.license?.trim())
    lines.push(`license: ${yamlValue(input.license.trim())}`);
  if (input.compatibility?.trim())
    lines.push(`compatibility: ${yamlValue(input.compatibility.trim())}`);
  if (input.allowedTools?.length)
    lines.push(`allowed-tools: ${input.allowedTools.join(" ")}`);
  lines.push("---", "", input.instructions.trim(), "");
  return lines.join("\n");
}

function validateWriteInput(input: AgentSkillWriteInput): void {
  validateSkillName(input.name);
  if (!input.description.trim())
    throw new Error("INVALID_INPUT: skill description is required");
  if (!input.instructions.trim())
    throw new Error("INVALID_INPUT: skill instructions are required");
  const unknown = (input.allowedTools ?? []).filter(
    (tool) => !KNOWN_TOOLS.has(tool),
  );
  if (unknown.length)
    throw new Error(
      `INVALID_INPUT: unknown allowed tool(s): ${unknown.join(", ")}`,
    );
  const bytes = Buffer.byteLength(serializeSkill(input), "utf8");
  if (bytes > MAX_SKILL_BYTES)
    throw new Error(
      `SKILL_TOO_LARGE: generated SKILL.md exceeds ${MAX_SKILL_BYTES} bytes`,
    );
}

function validateSkillName(name: string): void {
  if (!SKILL_NAME_PATTERN.test(name))
    throw new Error(
      "INVALID_INPUT: skill name must use lowercase letters, numbers and single hyphens",
    );
}

function isWritableSource(source: string): boolean {
  return source === "user" || source === "workspace";
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function yamlValue(value: string): string {
  return JSON.stringify(value);
}

function scoreSkill(
  skill: AgentSkillSummary,
  normalizedQuery: string,
  queryTerms: string[],
): number {
  const name = skill.name.toLowerCase();
  const description = skill.description.toLowerCase();
  let score = 0;
  if (name === normalizedQuery) score += 100;
  if (name.includes(normalizedQuery)) score += 40;
  if (description.includes(normalizedQuery)) score += 24;
  for (const term of queryTerms) {
    if (name.includes(term)) score += 8;
    if (description.includes(term)) score += 3;
  }
  return score;
}

function tokenize(value: string): string[] {
  return [
    ...new Set(
      value.split(/[^\p{L}\p{N}_-]+/u).filter((term) => term.length >= 2),
    ),
  ];
}

function unquote(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  )
    return value.slice(1, -1);
  return value;
}

async function isDirectory(value: string): Promise<boolean> {
  return stat(value)
    .then((info) => info.isDirectory())
    .catch(() => false);
}

async function isFile(value: string): Promise<boolean> {
  return stat(value)
    .then((info) => info.isFile())
    .catch(() => false);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}
