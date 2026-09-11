import AdmZip from "adm-zip";
import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

const MAX_SKILL_BYTES = 256 * 1024;
const MAX_SKILLS = 500;
const MAX_REMOTE_SKILL_FILES = 300;
const MAX_REMOTE_SKILL_FILE_BYTES = 8 * 1024 * 1024;
const MAX_REMOTE_SKILL_TOTAL_BYTES = 32 * 1024 * 1024;
const REMOTE_FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_SKILL_REGISTRY = "https://skills.sh";
const SKILL_ORIGIN_FILE = ".qnector-origin.json";
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const GITHUB_OWNER_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38})$/i;
const GITHUB_REPO_PATTERN = /^[a-z0-9._-]+$/i;
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
  origin?: AgentSkillOrigin;
  enabled: boolean;
}

export interface AgentSkillOrigin {
  registry: "skills.sh";
  id: string;
  source: string;
  skillId: string;
  url: string;
  registryHash?: string;
  contentHash?: string;
  installs?: number;
  installedAt: string;
}

export interface RemoteAgentSkillSummary {
  id: string;
  name: string;
  skillId: string;
  source: string;
  installs: number;
  url: string;
  installable: boolean;
  installed: boolean;
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
  registryBaseUrl?: string;
  fetchImpl?: typeof fetch;
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

  public async searchRemote(input: {
    query: string;
    limit?: number;
    owner?: string;
  }): Promise<RemoteAgentSkillSummary[]> {
    const query = input.query.trim();
    if (query.length < 2)
      throw new Error(
        "INVALID_INPUT: skills.sh search query must be at least 2 characters",
      );
    const owner = input.owner?.trim().toLowerCase();
    if (owner && !GITHUB_OWNER_PATTERN.test(owner))
      throw new Error("INVALID_INPUT: owner must be a valid GitHub owner");
    const limit = clamp(input.limit ?? 20, 1, 50);
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    if (owner) params.set("owner", owner);
    const response = await this.registryFetch(
      `/api/search?${params.toString()}`,
    );
    if (!response.ok)
      throw new Error(
        `SKILLS_REGISTRY_ERROR: skills.sh search returned HTTP ${response.status}`,
      );
    const payload = (await response.json()) as { skills?: unknown };
    if (!Array.isArray(payload.skills))
      throw new Error(
        "SKILLS_REGISTRY_ERROR: skills.sh returned an invalid search payload",
      );
    const installed = new Set(
      (await this.discover(true)).map((skill) => skill.name.toLowerCase()),
    );
    return payload.skills
      .map((entry) => parseRemoteSearchEntry(entry, this.registryBaseUrl()))
      .filter((entry): entry is RemoteAgentSkillSummary => Boolean(entry))
      .slice(0, limit)
      .map((entry) => ({
        ...entry,
        installed: installed.has(entry.name.toLowerCase()),
      }));
  }

  public async installRemote(
    remoteId: string,
    scope: "user" | "workspace",
  ): Promise<AgentSkillDocument> {
    const parsedId = parseRemoteSkillId(remoteId);
    const root = this.writableRoot(scope);
    await mkdir(root.path, { recursive: true });
    const response = await this.registryFetch(
      `/api/download/${encodeURIComponent(parsedId.owner)}/${encodeURIComponent(parsedId.repo)}/${encodeURIComponent(parsedId.skillId)}`,
    );
    if (!response.ok)
      throw new Error(
        `SKILLS_REGISTRY_ERROR: skills.sh download returned HTTP ${response.status}`,
      );
    const payload = (await response.json()) as {
      files?: unknown;
      hash?: unknown;
    };
    const snapshot = validateRemoteSnapshot(payload.files);
    const skillFile = snapshot.find(
      (file) => file.path.toLowerCase() === "skill.md",
    );
    if (!skillFile)
      throw new Error(
        "SKILL_IMPORT_INVALID: skills.sh snapshot does not contain SKILL.md",
      );
    const parsed = parseSkill(skillFile.contents, `${remoteId}:SKILL.md`);
    const name = parsed.frontmatter.name!.trim();
    validateSkillName(name);
    const destination = path.join(root.path, name);
    if (await isDirectory(destination))
      throw new Error(`SKILL_EXISTS: ${name}`);

    const registryHash =
      typeof payload.hash === "string" ? payload.hash.trim().toLowerCase() : "";
    if (registryHash && !/^[a-f0-9]{64}$/.test(registryHash))
      throw new Error(
        `SKILLS_REGISTRY_ERROR: skills.sh returned an invalid snapshot hash for ${remoteId}`,
      );
    // skills.sh treats its download hash as registry metadata; the official CLI
    // does not recompute and compare it for a full snapshot. Keep that value for
    // provenance and also compute a Qnector-owned content digest over the exact
    // files we write so the installed snapshot can be identified deterministically.
    const contentHash = hashRemoteSnapshot(snapshot);

    const staging = path.join(root.path, `.qnector-install-${randomUUID()}`);
    const origin: AgentSkillOrigin = {
      registry: "skills.sh",
      id: remoteId,
      source: `${parsedId.owner}/${parsedId.repo}`,
      skillId: parsedId.skillId,
      url: `${this.registryBaseUrl()}/${remoteId}`,
      ...(registryHash ? { registryHash } : {}),
      contentHash,
      installedAt: new Date().toISOString(),
    };
    try {
      await mkdir(staging, { recursive: true });
      for (const file of snapshot) {
        const target = path.resolve(staging, ...file.path.split("/"));
        if (!isWithin(staging, target))
          throw new Error(
            `SKILL_IMPORT_INVALID: unsafe snapshot path ${file.path}`,
          );
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, file.contents, "utf8");
      }
      await writeFile(
        path.join(staging, SKILL_ORIGIN_FILE),
        `${JSON.stringify(origin, null, 2)}\n`,
        "utf8",
      );
      await rename(staging, destination);
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(
        () => undefined,
      );
      throw error;
    }
    await this.setEnabled(name, true);
    return this.get(name, { includeDisabled: true });
  }

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

  private registryBaseUrl(): string {
    return (this.options.registryBaseUrl ?? DEFAULT_SKILL_REGISTRY).replace(
      /\/+$/,
      "",
    );
  }

  private registryFetch(relativeUrl: string): Promise<Response> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    return fetchImpl(`${this.registryBaseUrl()}${relativeUrl}`, {
      headers: { "User-Agent": "Qnector Agent Skills" },
      signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS),
    });
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
          const origin = await readSkillOrigin(directory);
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
            ...(origin ? { origin } : {}),
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
  let data: Record<string, unknown>;
  try {
    const value = parseYaml(yaml);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("frontmatter must be an object");
    data = value as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `SKILL_INVALID: ${file} has invalid YAML frontmatter: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const frontmatter: ParsedSkill["frontmatter"] = {
    ...(stringMetadata(data.name) ? { name: stringMetadata(data.name) } : {}),
    ...(stringMetadata(data.description)
      ? { description: stringMetadata(data.description) }
      : {}),
    ...(stringMetadata(data.license)
      ? { license: stringMetadata(data.license) }
      : {}),
    ...(stringMetadata(data.compatibility)
      ? { compatibility: stringMetadata(data.compatibility) }
      : {}),
  };
  const allowedTools = stringListMetadata(
    data["allowed-tools"] ?? data.allowed_tools,
  );
  if (allowedTools.length) frontmatter.allowedTools = allowedTools;
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

function stringMetadata(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringListMetadata(value: unknown): string[] {
  if (Array.isArray(value))
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
  if (typeof value !== "string") return [];
  return value
    .split(/[ ,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

type RemoteSnapshotFile = { path: string; contents: string };

function validateRemoteSnapshot(value: unknown): RemoteSnapshotFile[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error("SKILL_IMPORT_INVALID: skills.sh snapshot has no files");
  if (value.length > MAX_REMOTE_SKILL_FILES)
    throw new Error(
      `SKILL_TOO_LARGE: skills.sh snapshot exceeds ${MAX_REMOTE_SKILL_FILES} files`,
    );
  let totalBytes = 0;
  const files: RemoteSnapshotFile[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object")
      throw new Error("SKILL_IMPORT_INVALID: invalid skills.sh snapshot entry");
    const record = raw as Record<string, unknown>;
    if (typeof record.path !== "string" || typeof record.contents !== "string")
      throw new Error(
        "SKILL_IMPORT_INVALID: snapshot entries require path and contents",
      );
    const safePath = validateRemotePath(record.path);
    const key =
      process.platform === "win32" ? safePath.toLowerCase() : safePath;
    if (seen.has(key))
      throw new Error(
        `SKILL_IMPORT_INVALID: duplicate snapshot path ${safePath}`,
      );
    seen.add(key);
    const bytes = Buffer.byteLength(record.contents, "utf8");
    if (bytes > MAX_REMOTE_SKILL_FILE_BYTES)
      throw new Error(
        `SKILL_TOO_LARGE: ${safePath} exceeds ${MAX_REMOTE_SKILL_FILE_BYTES} bytes`,
      );
    totalBytes += bytes;
    if (totalBytes > MAX_REMOTE_SKILL_TOTAL_BYTES)
      throw new Error(
        `SKILL_TOO_LARGE: skills.sh snapshot exceeds ${MAX_REMOTE_SKILL_TOTAL_BYTES} bytes`,
      );
    files.push({ path: safePath, contents: record.contents });
  }
  return files;
}

function validateRemotePath(value: string): string {
  if (
    !value ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.startsWith("/")
  )
    throw new Error(`SKILL_IMPORT_INVALID: unsafe snapshot path ${value}`);
  const normalized = path.posix.normalize(value);
  if (
    normalized !== value ||
    normalized === "." ||
    normalized.startsWith("../")
  )
    throw new Error(`SKILL_IMPORT_INVALID: unsafe snapshot path ${value}`);
  for (const segment of normalized.split("/")) {
    if (
      !segment ||
      segment === "." ||
      segment === ".." ||
      /[<>:"|?*\x00-\x1f]/.test(segment) ||
      /[. ]$/.test(segment) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)
    )
      throw new Error(`SKILL_IMPORT_INVALID: unsafe snapshot path ${value}`);
  }
  return normalized;
}

function hashRemoteSnapshot(files: RemoteSnapshotFile[]): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) =>
    a.path === b.path ? 0 : a.path < b.path ? -1 : 1,
  )) {
    hash.update(file.path);
    hash.update(file.contents);
  }
  return hash.digest("hex");
}

function parseRemoteSkillId(remoteId: string): {
  owner: string;
  repo: string;
  skillId: string;
} {
  const parts = remoteId.trim().split("/");
  if (
    parts.length !== 3 ||
    !GITHUB_OWNER_PATTERN.test(parts[0] ?? "") ||
    !GITHUB_REPO_PATTERN.test(parts[1] ?? "") ||
    !SKILL_NAME_PATTERN.test(parts[2] ?? "")
  )
    throw new Error(
      "SKILL_REMOTE_UNSUPPORTED: install currently requires a GitHub-backed skills.sh id (owner/repo/skill)",
    );
  return { owner: parts[0]!, repo: parts[1]!, skillId: parts[2]! };
}

function parseRemoteSearchEntry(
  value: unknown,
  registryBaseUrl: string,
): RemoteAgentSkillSummary | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const id = stringMetadata(record.id);
  const name = stringMetadata(record.name);
  const skillId = stringMetadata(record.skillId) ?? name;
  const source = stringMetadata(record.source) ?? "";
  if (!id || !name || !skillId) return undefined;
  const sourceParts = source.split("/");
  const installable =
    sourceParts.length === 2 &&
    GITHUB_OWNER_PATTERN.test(sourceParts[0] ?? "") &&
    GITHUB_REPO_PATTERN.test(sourceParts[1] ?? "") &&
    SKILL_NAME_PATTERN.test(skillId);
  return {
    id,
    name,
    skillId,
    source,
    installs:
      typeof record.installs === "number" && Number.isFinite(record.installs)
        ? Math.max(0, Math.floor(record.installs))
        : 0,
    url: `${registryBaseUrl.replace(/\/+$/, "")}/${id}`,
    installable,
    installed: false,
  };
}

async function readSkillOrigin(
  directory: string,
): Promise<AgentSkillOrigin | undefined> {
  try {
    const parsed = JSON.parse(
      await readFile(path.join(directory, SKILL_ORIGIN_FILE), "utf8"),
    ) as Partial<AgentSkillOrigin>;
    if (
      parsed.registry !== "skills.sh" ||
      !parsed.id ||
      !parsed.source ||
      !parsed.skillId ||
      !parsed.url ||
      !parsed.installedAt
    )
      return undefined;
    return parsed as AgentSkillOrigin;
  } catch {
    return undefined;
  }
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
