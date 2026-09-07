import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const MAX_SKILL_BYTES = 256 * 1024;
const MAX_SKILLS = 500;

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
}

export interface AgentSkillDocument extends AgentSkillSummary {
  instructions: string;
  bytes: number;
}

export interface AgentSkillStatus {
  roots: Array<AgentSkillRoot & { available: boolean }>;
  skillCount: number;
  skills: AgentSkillSummary[];
}

export interface AgentSkillServiceOptions {
  roots?: AgentSkillRoot[];
  workspaceRoot?: () => string | undefined;
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
    const skills = await this.list();
    return { roots: rootStatus, skillCount: skills.length, skills };
  }

  public async list(
    input: { query?: string; limit?: number } = {},
  ): Promise<AgentSkillSummary[]> {
    const discovered = await this.discover();
    const query = input.query?.trim().toLowerCase();
    const filtered = query
      ? discovered.filter((skill) =>
          `${skill.name}\n${skill.description}`.toLowerCase().includes(query),
        )
      : discovered;
    return filtered.slice(0, clamp(input.limit ?? 100, 1, MAX_SKILLS));
  }

  public async match(query: string, limit = 5): Promise<AgentSkillSummary[]> {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    const terms = tokenize(normalized);
    const scored = (await this.discover())
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

  public async get(name: string): Promise<AgentSkillDocument> {
    const requested = name.trim().toLowerCase();
    if (!requested) throw new Error("INVALID_INPUT: skill name is required");
    const summary = (await this.discover()).find(
      (entry) => entry.name.toLowerCase() === requested,
    );
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

  private async discover(): Promise<AgentSkillSummary[]> {
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
          byName.set(key, {
            name,
            description,
            path: file,
            directory,
            source: root.source,
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
    return [...byName.values()].sort((a, b) =>
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
