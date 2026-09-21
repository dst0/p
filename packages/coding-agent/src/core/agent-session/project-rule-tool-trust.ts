import { FINISH_WORK_TOOL_NAME } from "@dst0/p-agent-core";
import { SLEEP_TOOL_NAME } from "../messages.ts";
import { isConfidentlyReadOnlyShellTool } from "../task-verification/tool-classification.ts";
import { resolveToolDefinitionEffect } from "../tools/tool-effects.ts";
import type { AgentSession } from "./agentsession.ts";
import { MARK_SESSION_PROGRESS_TOOL_NAME, UPDATE_SESSION_STATE_TOOL_NAME } from "./constants.ts";
import { isProjectInstructionVerificationControlPlaneAction } from "./project-instruction-action-phases.ts";

const PROJECT_RULE_GATE_SAFE_TOOLS = new Set([
  "ask_user",
  "confirm_user",
  "find",
  FINISH_WORK_TOOL_NAME,
  "grep",
  "keep_context",
  "list_skills",
  "list",
  "ls",
  MARK_SESSION_PROGRESS_TOOL_NAME,
  "read",
  "read_rules",
  "read_skills",
  "semantic_search",
  "session_recall",
  SLEEP_TOOL_NAME,
  "tool_search",
  UPDATE_SESSION_STATE_TOOL_NAME,
]);

export function isTrustedProjectRuleTool(self: AgentSession, toolName: string, args: unknown): boolean {
  return (
    isTrustedProjectRuleReadOnlyShellTool(self, toolName, args) ||
    isTrustedProjectRuleSafeTool(self, toolName) ||
    isTrustedVerificationControlPlaneTool(self, toolName, args) ||
    isTrustedDeclaredReadOnlyTool(self, toolName)
  );
}

function isTrustedDeclaredReadOnlyTool(self: AgentSession, toolName: string): boolean {
  const entry = self._toolDefinitions.get(toolName);
  if (!entry || entry.sourceInfo.source === "builtin" || self._baseToolDefinitions.has(toolName)) return false;
  const effect = resolveToolDefinitionEffect(entry.definition, "declared");
  return (
    effect.source === "declared" && effect.kind === "read" && effect.risk === "normal" && effect.domains.length === 0
  );
}

function isTrustedProjectRuleSafeTool(self: AgentSession, toolName: string): boolean {
  return PROJECT_RULE_GATE_SAFE_TOOLS.has(toolName) && isTrustedBaseTool(self, toolName);
}

function isTrustedVerificationControlPlaneTool(self: AgentSession, toolName: string, args: unknown): boolean {
  const entry = self._toolDefinitions.get(toolName);
  if (!entry || !self._projectRuleSafeToolDefinitions.has(entry.definition)) return false;
  return isProjectInstructionVerificationControlPlaneAction(toolName, args);
}

function isTrustedProjectRuleReadOnlyShellTool(self: AgentSession, toolName: string, args: unknown): boolean {
  return (
    !self.settingsManager.getShellCommandPrefix()?.trim() &&
    isConfidentlyReadOnlyShellTool(toolName, args) &&
    isTrustedBaseTool(self, toolName)
  );
}

function isTrustedBaseTool(self: AgentSession, toolName: string): boolean {
  const entry = self._toolDefinitions.get(toolName);
  const baseDefinition = self._baseToolDefinitions.get(toolName);
  if (!entry || entry.sourceInfo.source !== "builtin" || entry.definition !== baseDefinition) return false;
  return !self._baseToolsOverride || !Object.hasOwn(self._baseToolsOverride, toolName);
}
