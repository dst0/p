import { createHash } from "node:crypto";
import { FINISH_WORK_TOOL_NAME } from "@dst0/p-agent-core";
import type { ImageContent, TextContent } from "@dst0/p-ai";
import { SLEEP_TOOL_NAME } from "../../messages.ts";
import {
  matchesProjectInstructionRuleBatch,
  type PreparedProjectInstructions,
} from "../../project-instructions/index.ts";
import { REQUIREMENT_AUDIT_TOOL_NAME, TASK_VERIFICATION_TOOL_NAME } from "../../task-verification/constants.ts";
import {
  isConfidentlyReadOnlyShellTool,
  isPotentialMutationTool,
} from "../../task-verification/tool-classification.ts";
import type { AgentSession } from "../agentsession.ts";
import { MARK_SESSION_PROGRESS_TOOL_NAME, UPDATE_SESSION_STATE_TOOL_NAME } from "../constants.ts";
import { getFinishWorkStatus, isRecord } from "../message-utils.ts";
import { stageProjectInstructionActionBatch } from "../project-instruction-action-routing.ts";
import { PROJECT_RULE_RECEIPT_CUSTOM_TYPE } from "../project-instruction-integrity.ts";

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

export function do__installAgentToolHooks(self: AgentSession): void {
  self.agent.beforeToolCall = async ({ toolCall, args }) => {
    if (toolCall.name === "read_rules") {
      self._projectRuleReadStages.delete(toolCall.id);
    }
    if (
      self._stateUpdateRequiredForCurrentUserTurn &&
      toolCall.name !== UPDATE_SESSION_STATE_TOOL_NAME &&
      toolCall.name !== SLEEP_TOOL_NAME
    ) {
      self._autoExecuteUpdateSessionState();
    }
    if (self._progressUpdateRequiredBeforeFinish && toolCall.name === FINISH_WORK_TOOL_NAME) {
      self._autoExecuteUpdateSessionState();
    }
    if (toolCall.name === FINISH_WORK_TOOL_NAME) {
      const blockReason = self._getFinishWorkSessionStateBlockReason(args);
      if (blockReason) {
        self._autoExecuteUpdateSessionState();
        const updatedBlockReason = self._getFinishWorkSessionStateBlockReason(args);
        if (updatedBlockReason) {
          return { block: true, reason: updatedBlockReason };
        }
      }
    }

    const projectRuleBlockReason = await getProjectRuleBlockReason(self, toolCall.name, args);
    if (projectRuleBlockReason) {
      return { block: true, reason: projectRuleBlockReason };
    }

    const runner = self._extensionRunner;
    if (!runner.hasHandlers("tool_call")) {
      return undefined;
    }

    try {
      const extensionResult = await runner.emitToolCall({
        type: "tool_call",
        toolName: toolCall.name,
        toolCallId: toolCall.id,
        input: args as Record<string, unknown>,
      });
      if (extensionResult?.block) return extensionResult;
      const finalProjectRuleBlockReason = await getProjectRuleBlockReason(self, toolCall.name, args);
      return finalProjectRuleBlockReason ? { block: true, reason: finalProjectRuleBlockReason } : extensionResult;
    } catch (err) {
      if (err instanceof Error) {
        throw err;
      }
      throw new Error(`Extension failed, blocking execution: ${String(err)}`);
    }
  };

  self.agent.afterToolCall = async ({ toolCall, args, result, isError, context }, signal) => {
    let content = result.content;
    let details: unknown = result.details;
    let nextIsError = isError;
    let changed = false;
    let commitProjectRuleRead = false;
    try {
      const runner = self._extensionRunner;
      if (runner.hasHandlers("tool_result")) {
        const hookResult = await runner.emitToolResult({
          type: "tool_result",
          toolName: toolCall.name,
          toolCallId: toolCall.id,
          input: args as Record<string, unknown>,
          content,
          details,
          isError: nextIsError,
        });

        if (hookResult) {
          content = hookResult.content ?? content;
          details = hookResult.details ?? details;
          nextIsError = hookResult.isError ?? nextIsError;
          changed = true;
        }
      }

      const extract = await self._maybeCreateToolResultContextExtract(
        toolCall.name,
        content,
        details,
        nextIsError,
        context.messages,
        signal,
      );
      if (extract) {
        details = {
          ...(isRecord(details) ? details : {}),
          contextExtract: extract,
        };
        changed = true;
      }

      if (toolCall.name === UPDATE_SESSION_STATE_TOOL_NAME && !nextIsError) {
        self._stateUpdateRequiredForCurrentUserTurn = false;
        self._progressUpdateRequiredBeforeFinish = false;
      } else if (toolCall.name === MARK_SESSION_PROGRESS_TOOL_NAME && !nextIsError) {
        self._progressUpdateRequiredBeforeFinish = false;
      } else if (!nextIsError && toolCall.name !== SLEEP_TOOL_NAME && toolCall.name !== FINISH_WORK_TOOL_NAME) {
        self._progressUpdateRequiredBeforeFinish = true;
      }

      if (toolCall.name === FINISH_WORK_TOOL_NAME && getFinishWorkStatus(args) === "success" && !nextIsError) {
        self._reconcileSuccessfulFinishWorkState();
      }

      commitProjectRuleRead = !nextIsError;
      return changed ? { content, details, isError: nextIsError } : undefined;
    } finally {
      await settleProjectRuleRead(self, toolCall.name, toolCall.id, commitProjectRuleRead, content, details);
    }
  };
}
export function digestProjectRuleReadContent(content: readonly (TextContent | ImageContent)[]): string[] {
  return content.map((item) => {
    const payload = item.type === "text" ? `text\0${item.text}` : `image\0${item.mimeType}\0${item.data}`;
    return createHash("sha256").update(payload).digest("hex");
  });
}
async function settleProjectRuleRead(
  self: AgentSession,
  toolName: string,
  toolCallId: string,
  succeeded: boolean,
  content: readonly (TextContent | ImageContent)[],
  details: unknown,
): Promise<void> {
  if (toolName !== "read_rules") return;
  const staged = self._projectRuleReadStages.get(toolCallId);
  self._projectRuleReadStages.delete(toolCallId);
  if (!staged || !succeeded) return;
  const finalContentDigests = new Set(digestProjectRuleReadContent(content));
  const finalLinks =
    isRecord(details) && Array.isArray(details.links)
      ? details.links.filter((link): link is string => typeof link === "string")
      : [];
  if (
    staged.contentDigests.length === 0 ||
    !staged.contentDigests.every((digest) => finalContentDigests.has(digest)) ||
    !matchesProjectInstructionRuleBatch(staged.links, finalLinks)
  ) {
    return;
  }
  let refreshed: PreparedProjectInstructions;
  try {
    refreshed = await self._projectInstructions.refresh();
  } catch {
    return;
  }
  const gate = self._projectRuleGate;
  const currentInputHash = refreshed.manifest.inputHash;
  if (refreshed.manifest.mode === "fallback") return;
  if (!gate || gate.failure || gate.inputHash !== staged.inputHash || currentInputHash !== staged.inputHash) return;
  const matchingBatch = gate.batches.find(
    (batch) =>
      !batch.satisfied &&
      batch.generation === staged.generation &&
      matchesProjectInstructionRuleBatch(batch.links, staged.links),
  );
  if (matchingBatch) {
    self.sessionManager.appendCustomEntry(PROJECT_RULE_RECEIPT_CUSTOM_TYPE, {
      version: 1,
      inputHash: gate.inputHash,
      links: [...matchingBatch.links],
    });
    matchingBatch.generation = gate.activeGeneration;
    matchingBatch.satisfied = true;
  }
}

async function getProjectRuleBlockReason(
  self: AgentSession,
  toolName: string,
  args: unknown,
): Promise<string | undefined> {
  if (self._projectInstructionMode !== "compiled") return undefined;
  let gate = self._projectRuleGate;
  const pendingBatches = gate?.batches.filter((batch) => !batch.satisfied) ?? [];
  if (toolName === "read_rules") {
    if (!gate || gate.failure) return undefined;
    const links =
      isRecord(args) && Array.isArray(args.links) ? args.links.filter((link) => typeof link === "string") : [];
    const matchesPendingBatch = pendingBatches.some((batch) => matchesProjectInstructionRuleBatch(batch.links, links));
    if (!matchesPendingBatch) return undefined;
    const currentInputHash = self._projectInstructions.state.current?.manifest.inputHash;
    if (currentInputHash !== gate.inputHash) {
      return "Project instruction routes changed during this turn. Reload the session before mutating work.";
    }
    return undefined;
  }
  const mayMutate =
    isPotentialMutationTool(toolName, args) ||
    (!isTrustedProjectRuleReadOnlyShellTool(self, toolName, args) &&
      !isTrustedProjectRuleSafeTool(self, toolName) &&
      !isTrustedVerificationControlPlaneTool(self, toolName, args));
  if (!mayMutate) return undefined;
  let refreshed: PreparedProjectInstructions;
  try {
    refreshed = await self._projectInstructions.refresh();
  } catch (error) {
    return `Unable to verify current project instructions before mutating work: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
  if (!gate && refreshed.manifest.sources.length === 0 && refreshed.manifest.rules.length === 0) {
    gate = {
      inputHash: refreshed.manifest.inputHash,
      batches: [],
      activeGeneration: ++self._projectRuleGateGeneration,
    };
    self._projectRuleGate = gate;
  }
  if (!gate) {
    return "No project instruction freshness checkpoint exists for this turn. Start a new turn before mutating work.";
  }
  if (refreshed.manifest.mode === "fallback") {
    if (!mayMutate) return undefined;
    return "Compiled project instructions are unavailable. Reload with project instruction mode legacy before mutating work.";
  }
  if (refreshed.manifest.inputHash !== gate.inputHash) {
    return "Project instruction routes changed during this turn. Reload the session before mutating work.";
  }
  if (gate.failure) return gate.failure;
  const actionRoutingFailure = stageProjectInstructionActionBatch(self, refreshed, toolName, args);
  if (actionRoutingFailure) return actionRoutingFailure;
  const currentPendingBatches = gate.batches.filter((batch) => !batch.satisfied);
  if (currentPendingBatches.length === 0) return undefined;
  return `Call read_rules with each selected authoritative batch before continuing: ${JSON.stringify(
    currentPendingBatches.map((batch) => ({ links: batch.links })),
  )}.`;
}

function isTrustedProjectRuleSafeTool(self: AgentSession, toolName: string): boolean {
  if (!PROJECT_RULE_GATE_SAFE_TOOLS.has(toolName)) return false;
  return isTrustedBaseTool(self, toolName);
}

function isTrustedVerificationControlPlaneTool(self: AgentSession, toolName: string, args: unknown): boolean {
  const entry = self._toolDefinitions.get(toolName);
  if (!entry || !self._projectRuleSafeToolDefinitions.has(entry.definition)) return false;
  if (toolName === REQUIREMENT_AUDIT_TOOL_NAME) return true;
  return toolName === TASK_VERIFICATION_TOOL_NAME && isRecord(args) && args.action === "status";
}

function isTrustedProjectRuleReadOnlyShellTool(self: AgentSession, toolName: string, args: unknown): boolean {
  return isConfidentlyReadOnlyShellTool(toolName, args) && isTrustedBaseTool(self, toolName);
}

function isTrustedBaseTool(self: AgentSession, toolName: string): boolean {
  const entry = self._toolDefinitions.get(toolName);
  const baseDefinition = self._baseToolDefinitions.get(toolName);
  if (!entry || entry.sourceInfo.source !== "builtin" || entry.definition !== baseDefinition) return false;
  return !self._baseToolsOverride || !Object.hasOwn(self._baseToolsOverride, toolName);
}
