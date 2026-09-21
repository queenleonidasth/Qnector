import { randomUUID } from "node:crypto";
import {
  booleanInput,
  numberInput,
  stringInput,
  type ToolContext,
} from "./tool-result.js";
const DEFAULT_ROUTE_SKILL_LIMIT = 3;
const COMPACT_SKILL_INSTRUCTION_CHARS = 1_200;
/** Skill catalog adapter; called only when a skills action is explicitly invoked. */
export async function executeSystemSkills(
  context: ToolContext,
  action: string,
  object: Record<string, unknown>,
) {
  if (action === "skills_status") {
    const agentSkills = requireAgentSkills(context);
    const status = await agentSkills.status();
    return {
      summary: `Agent Skills runtime found ${status.skillCount} skill(s) across ${status.roots.length} root(s)`,
      data: status,
    };
  }
  if (action === "skills_list") {
    const agentSkills = requireAgentSkills(context);
    const skills = await agentSkills.list({
      query: stringInput(object, "query"),
      limit: numberInput(object, "maxResults", 100),
    });
    return {
      summary: `Agent Skills list returned ${skills.length} skill(s)`,
      data: { skills },
    };
  }
  if (action === "skills_match") {
    const agentSkills = requireAgentSkills(context);
    const query = stringInput(object, "query", true)!;
    const maxResults = numberInput(object, "maxResults", 5);
    const plan = await agentSkills.plan(query, 5, maxResults);
    return {
      summary: `Matched ${plan.matches.length} Agent Skill(s); runtime would activate ${plan.selected.length}`,
      data: {
        query,
        skills: plan.matches,
        wouldActivate: plan.selected,
        decisions: plan.decisions,
      },
    };
  }
  if (action === "skills_route") {
    const agentSkills = requireAgentSkills(context);
    const query = stringInput(object, "query", true)!;
    const details = booleanInput(object, "details", false);
    const existingTrace = context.skillTrace;
    if (
      existingTrace?.routeId &&
      existingTrace.skills.length > 0 &&
      sameRouteQuery(existingTrace.query, query)
    ) {
      const names = existingTrace.skills.map((skill) => skill.name);
      if (!details) {
        return {
          summary: `Reused ${names.length} Agent Skill(s): ${names.join(", ")}`,
          data: {
            mode: "compact",
            routeId: existingTrace.routeId,
            reused: true,
            skills: names.map((name) => ({ name })),
          },
        };
      }
      const skills = await Promise.all(
        existingTrace.skills.map((skill) => agentSkills.get(skill.name)),
      );
      return {
        summary: `Reused ${names.length} Agent Skill(s): ${names.join(", ")}`,
        data: routeResponseData({
          query,
          routeId: existingTrace.routeId,
          skills,
          decisions: existingTrace.routingDecisions ?? [],
          details,
          reused: true,
        }),
      };
    }
    const maxResults = numberInput(
      object,
      "maxResults",
      DEFAULT_ROUTE_SKILL_LIMIT,
    );
    const plan = await agentSkills.plan(
      query,
      maxResults,
      Math.max(8, maxResults),
    );
    const skills = await Promise.all(
      plan.selected.map((skill) => agentSkills.get(skill.name)),
    );
    const routeId = randomUUID();
    if (context.skillTrace) {
      context.skillTrace.routeId = routeId;
      context.skillTrace.query = query;
      context.skillTrace.activatedAt = new Date().toISOString();
      context.skillTrace.skills = skills.map((skill) => ({
        name: skill.name,
        ...(skill.allowedTools?.length
          ? { allowedTools: [...skill.allowedTools] }
          : {}),
      }));
      context.skillTrace.routingDecisions = plan.decisions;
      if (context.skillTraceStore) {
        context.skillTraceStore.byRouteId ??= new Map();
        context.skillTraceStore.byRouteId.set(routeId, context.skillTrace);
        while (context.skillTraceStore.byRouteId.size > 100) {
          const oldest = context.skillTraceStore.byRouteId.keys().next()
            .value as string | undefined;
          if (!oldest) break;
          context.skillTraceStore.byRouteId.delete(oldest);
        }
      }
    }
    return {
      summary:
        skills.length > 0
          ? `Activated ${skills.length} Agent Skill(s): ${skills.map((skill) => skill.name).join(", ")}`
          : `No Agent Skills passed the runtime routing threshold for '${query}'`,
      data: routeResponseData({
        query,
        routeId,
        skills,
        decisions: plan.decisions,
        details,
        reused: false,
      }),
    };
  }
  if (action === "skills_search_remote") {
    const agentSkills = requireAgentSkills(context);
    const query = stringInput(object, "query", true)!;
    const skills = await agentSkills.searchRemote({
      query,
      limit: numberInput(object, "maxResults", 20),
      ...(stringInput(object, "owner")
        ? { owner: stringInput(object, "owner") }
        : {}),
    });
    return {
      summary: `skills.sh search returned ${skills.length} result(s) for '${query}'`,
      data: { query, skills },
    };
  }
  if (action === "skill_install_remote") {
    const agentSkills = requireAgentSkills(context);
    const remoteId = stringInput(object, "remoteId", true)!;
    const skill = await agentSkills.installRemote(
      remoteId,
      requiredSkillScope(object),
    );
    return {
      summary: `Installed Agent Skill ${skill.name} from skills.sh`,
      data: skill,
    };
  }
  if (action === "skill_get") {
    const agentSkills = requireAgentSkills(context);
    const skill = await agentSkills.get(stringInput(object, "name", true)!, {
      includeDisabled: true,
    });
    // An explicit skill_get activates a named, enabled Skill without matching.
    if (skill.enabled && context.skillTrace) {
      const routeId = randomUUID();
      context.skillTrace.routeId = routeId;
      context.skillTrace.query = `skill_get:${skill.name}`;
      context.skillTrace.activatedAt = new Date().toISOString();
      context.skillTrace.skills = [
        {
          name: skill.name,
          ...(skill.allowedTools?.length
            ? { allowedTools: [...skill.allowedTools] }
            : {}),
        },
      ];
      context.skillTrace.routingDecisions = undefined;
      if (context.skillTraceStore) {
        context.skillTraceStore.byRouteId ??= new Map();
        context.skillTraceStore.byRouteId.set(routeId, context.skillTrace);
        while (context.skillTraceStore.byRouteId.size > 100) {
          const oldest = context.skillTraceStore.byRouteId.keys().next()
            .value as string | undefined;
          if (!oldest) break;
          context.skillTraceStore.byRouteId.delete(oldest);
        }
      }
    }
    return {
      summary: `Loaded Agent Skill ${skill.name}`,
      data: {
        ...skill,
        ...(skill.enabled && context.skillTrace?.routeId
          ? { routeId: context.skillTrace.routeId }
          : {}),
      },
    };
  }
  if (action === "skill_create" || action === "skill_update") {
    const agentSkills = requireAgentSkills(context);
    const name = stringInput(object, "name", true)!;
    const description = stringInput(object, "description", true)!;
    const instructions = stringInput(object, "instructions", true)!;
    const allowedTools = Array.isArray(object.allowedTools)
      ? object.allowedTools.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : undefined;
    const shared = {
      name,
      description,
      instructions,
      ...(stringInput(object, "license")
        ? { license: stringInput(object, "license") }
        : {}),
      ...(stringInput(object, "compatibility")
        ? { compatibility: stringInput(object, "compatibility") }
        : {}),
      ...(allowedTools ? { allowedTools } : {}),
    };
    const skill =
      action === "skill_create"
        ? await agentSkills.create({
            scope: requiredSkillScope(object),
            ...shared,
          })
        : await agentSkills.update(name, shared);
    return {
      summary: `${action === "skill_create" ? "Created" : "Updated"} Agent Skill ${skill.name}`,
      data: skill,
    };
  }
  if (action === "skill_delete") {
    const agentSkills = requireAgentSkills(context);
    const name = stringInput(object, "name", true)!;
    await agentSkills.remove(name);
    return { summary: `Deleted Agent Skill ${name}`, data: { name } };
  }
  if (action === "skill_enable") {
    const agentSkills = requireAgentSkills(context);
    const name = stringInput(object, "name", true)!;
    const enabled = booleanInput(object, "enabled", true);
    await agentSkills.setEnabled(name, enabled);
    return {
      summary: `${enabled ? "Enabled" : "Disabled"} Agent Skill ${name}`,
      data: { name, enabled },
    };
  }
  if (action === "skill_duplicate") {
    const agentSkills = requireAgentSkills(context);
    const skill = await agentSkills.duplicate(
      stringInput(object, "name", true)!,
      requiredSkillScope(object),
      stringInput(object, "newName"),
    );
    return { summary: `Duplicated Agent Skill ${skill.name}`, data: skill };
  }
  if (action === "skill_import") {
    const agentSkills = requireAgentSkills(context);
    const skill = await agentSkills.importSkill(
      stringInput(object, "sourcePath", true)!,
      requiredSkillScope(object),
    );
    return { summary: `Imported Agent Skill ${skill.name}`, data: skill };
  }
  if (action === "skill_validate") {
    const agentSkills = requireAgentSkills(context);
    const name = stringInput(object, "name", true)!;
    const validation = await agentSkills.validate(name);
    return {
      summary: `${validation.healthy ? "Validated" : "Validation issues in"} Agent Skill ${name}`,
      data: { name, ...validation },
    };
  }
  throw new Error(`INVALID_ACTION: Unknown skills action '${action}'`);
}

function requiredSkillScope(
  object: Record<string, unknown>,
): "user" | "workspace" {
  const scope = stringInput(object, "scope", true)!;
  if (scope !== "user" && scope !== "workspace")
    throw new Error("INVALID_INPUT: skill scope must be user or workspace");
  return scope;
}

function sameRouteQuery(previous: string | undefined, next: string): boolean {
  if (!previous) return false;
  return normalizeRouteQuery(previous) === normalizeRouteQuery(next);
}

function normalizeRouteQuery(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function routeResponseData(input: {
  query: string;
  routeId: string;
  skills: Array<{
    name: string;
    description: string;
    instructions: string;
    bytes: number;
    allowedTools?: string[];
  }>;
  decisions: unknown[];
  details: boolean;
  reused: boolean;
}): Record<string, unknown> {
  if (input.details) {
    return {
      mode: "diagnostic",
      query: input.query,
      routeId: input.routeId,
      reused: input.reused,
      skills: input.skills,
      decisions: input.decisions,
    };
  }
  return {
    mode: "compact",
    routeId: input.routeId,
    reused: input.reused,
    skills: input.skills.map((skill) => {
      const instructions = clipRouteText(
        skill.instructions,
        COMPACT_SKILL_INSTRUCTION_CHARS,
      );
      return {
        name: skill.name,
        description: clipRouteText(skill.description, 240),
        ...(skill.allowedTools?.length
          ? { allowedTools: [...skill.allowedTools] }
          : {}),
        instructions,
        instructionsTruncated: instructions.length < skill.instructions.length,
        instructionBytes: skill.bytes,
      };
    }),
  };
}

function clipRouteText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function requireAgentSkills(
  context: ToolContext,
): NonNullable<ToolContext["agentSkills"]> {
  if (!context.agentSkills)
    throw new Error(
      "UNSUPPORTED_CAPABILITY: agent skill runtime is not configured in this Qnector runtime",
    );
  return context.agentSkills;
}
