import { KNOWN_EVIDENCE_TOOLS, REQUIREMENT_AUDIT_TOOL_NAME, TASK_VERIFICATION_TOOL_NAME } from "../constants.ts";
import { resolvedToolEffectIsValid, type TaskVerificationResolvedToolEffect } from "../external-effect-state.ts";
import { isDirectMutationTool, isPublishCommand, isShellTool, shellCommand } from "../tool-classification.ts";
import { canPotentiallyChangeWorkspace } from "./requirement-source-gate.ts";
import { focusedTestInvocation } from "./test-command-invocation.ts";

interface ToolEffectContext {
  toolCall: { name: string };
  args: unknown;
}

export function resolvedTaskVerificationToolEffect(context: ToolEffectContext): TaskVerificationResolvedToolEffect {
  const toolName = context.toolCall.name;
  const declared = (context as ToolEffectContext & { effect?: unknown }).effect;
  if (resolvedToolEffectIsValid(declared) && declared.source !== "builtin") return structuredClone(declared);
  if (declared !== undefined && !resolvedToolEffectIsValid(declared)) {
    return { kind: "unknown", risk: "high", domains: [], source: "default_unknown" };
  }
  if (toolName === "finish_work" || isPublishCommand(toolName, context.args)) {
    return { kind: "read", risk: "normal", domains: [], source: "builtin" };
  }
  if (isShellTool(toolName) && focusedTestInvocation(shellCommand(context.args)) !== undefined) {
    return {
      kind: "read",
      risk: "normal",
      domains: [],
      source: resolvedToolEffectIsValid(declared) ? declared.source : "builtin",
    };
  }
  if (isDirectMutationTool(toolName) || canPotentiallyChangeWorkspace(toolName, context.args)) {
    return { kind: "workspace_write", risk: "normal", domains: [], source: "builtin" };
  }
  if (isShellTool(toolName)) return { kind: "read", risk: "normal", domains: [], source: "builtin" };
  if (resolvedToolEffectIsValid(declared)) return structuredClone(declared);
  if (
    KNOWN_EVIDENCE_TOOLS.has(toolName) ||
    toolName === TASK_VERIFICATION_TOOL_NAME ||
    toolName === REQUIREMENT_AUDIT_TOOL_NAME
  ) {
    return { kind: "read", risk: "normal", domains: [], source: "builtin" };
  }
  return { kind: "unknown", risk: "high", domains: [], source: "default_unknown" };
}
