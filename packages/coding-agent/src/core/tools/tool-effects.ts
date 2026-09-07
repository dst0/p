import {
  type ResolvedToolEffect,
  resolveToolEffect,
  type ToolEffectDeclaration,
  type ToolEffectSource,
} from "@dst0/p-agent-core";
import type { ToolDefinition } from "../extensions/types.ts";

const READ: ToolEffectDeclaration = { kind: "read", risk: "normal" };
const WORKSPACE_WRITE: ToolEffectDeclaration = { kind: "workspace_write", risk: "normal" };
const EXTERNAL_PROCESS: ToolEffectDeclaration = {
  kind: "external_write",
  risk: "high",
  domains: ["destructive", "persistent_state"],
};
const UNRESTRICTED: ToolEffectDeclaration = {
  kind: "unknown",
  risk: "high",
  domains: ["credentials", "destructive", "deployment", "network_send", "persistent_state", "publication"],
};

/**
 * Compatibility inventory for p-owned tools whose factories predate effect declarations.
 * Custom and extension tools never inherit classifications by name.
 */
const BUILTIN_TOOL_EFFECTS = new Map<string, ToolEffectDeclaration>([
  ["ask_user", READ],
  ["confirm_user", READ],
  ["find", READ],
  ["finish_work", READ],
  ["grep", READ],
  ["keep_context", READ],
  ["list_skills", READ],
  ["ls", READ],
  ["mark_session_progress", READ],
  ["read", READ],
  ["read_rules", READ],
  ["read_skills", READ],
  ["recall_learnings", READ],
  ["record_requirement_audit", READ],
  ["record_task_verification", READ],
  ["rg", READ],
  ["semantic_search", READ],
  ["session_recall", READ],
  ["sleep", READ],
  ["submit_plan", READ],
  ["tool_search", READ],
  ["update_session_state", READ],
  ["edit", WORKSPACE_WRITE],
  ["generate_image", WORKSPACE_WRITE],
  ["record_learning", { ...WORKSPACE_WRITE, domains: ["persistent_state"] }],
  ["write", WORKSPACE_WRITE],
  ["process", EXTERNAL_PROCESS],
  ["bash", UNRESTRICTED],
  ["run_subagent", UNRESTRICTED],
]);

export function resolveToolDefinitionEffect(
  definition: Pick<ToolDefinition, "effect" | "name">,
  source: Exclude<ToolEffectSource, "default_unknown">,
): ResolvedToolEffect {
  const declaration =
    definition.effect ?? (source === "builtin" ? BUILTIN_TOOL_EFFECTS.get(definition.name) : undefined);
  return resolveToolEffect(declaration, source);
}

export function resolveBuiltinToolEffect(name: string): ResolvedToolEffect | undefined {
  const declaration = BUILTIN_TOOL_EFFECTS.get(name);
  return declaration ? resolveToolEffect(declaration, "builtin") : undefined;
}

export function getBuiltinToolEffectNames(): readonly string[] {
  return [...BUILTIN_TOOL_EFFECTS.keys()];
}
