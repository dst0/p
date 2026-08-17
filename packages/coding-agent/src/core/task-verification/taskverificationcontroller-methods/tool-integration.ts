import type { Agent, AgentMessage, BeforeToolCallContext, BeforeToolCallResult } from "@dst0/p-agent-core";
import type { ToolDefinition } from "../../extensions/types.ts";
import { captureWorkspaceFingerprint } from "../../workspace-fingerprint.ts";
import { REQUIREMENT_AUDIT_TOOL_NAME, TASK_VERIFICATION_TOOL_NAME, VerificationSchema } from "../constants.ts";
import { emptyReadiness, emptyRequirementAudit } from "../state-factories.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import {
  argsRecord,
  inferTaskKind,
  isPotentialMutationTool,
  isPublishCommand,
  isRecord,
  isShellTool,
  normalizeText,
} from "../tool-classification.ts";
import type { VerificationResult } from "../types.ts";

export function do_install(self: TaskVerificationController, agent: Agent): void {
  if (self.installed) return;
  self.installed = true;
  const previousBeforeToolCall = agent.beforeToolCall;
  const previousAfterToolCall = agent.afterToolCall;

  agent.beforeToolCall = async (context, signal) => {
    const verificationGate = self.beforeToolCall(context);
    if (verificationGate?.block) return verificationGate;
    const previousResult = await previousBeforeToolCall?.(context, signal);
    if (previousResult?.block) return previousResult;
    if (isShellTool(context.toolCall.name) && !isPublishCommand(context.toolCall.name, context.args)) {
      self.bashFingerprints.set(context.toolCall.id, await captureWorkspaceFingerprint(self.sessionManager.getCwd()));
    }
    return previousResult;
  };

  agent.afterToolCall = async (context, signal) => {
    const previousResult = await previousAfterToolCall?.(context, signal);
    return self.afterToolCall(context, previousResult);
  };

  agent.subscribe((event) => {
    if (event.type === "turn_start") {
      self.modelTurn += 1;
      return;
    }
    if (event.type !== "message_end" || event.message.role !== "user") return;
    captureUserPrompt(self, event.message);
  });
}

function captureUserPrompt(self: TaskVerificationController, message: Extract<AgentMessage, { role: "user" }>): void {
  if (isRecord(message.metadata) && message.metadata.pInternal !== undefined) return;
  const promptText =
    typeof message.content === "string"
      ? message.content
      : message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
  if (!promptText.trim()) return;

  self.latestUserPrompt = promptText;
  const taskPrompts = self.state.taskPrompts ?? [];
  const persistedId = [...self.sessionManager.getBranch()]
    .reverse()
    .find(
      (entry) =>
        entry.type === "message" &&
        entry.message.role === "user" &&
        entry.message.timestamp === message.timestamp &&
        userMessageText(entry.message) === promptText,
    )?.id;
  self.state = {
    ...self.state,
    taskPrompts: [
      ...taskPrompts,
      {
        id: persistedId ?? `user-${message.timestamp}-${taskPrompts.length + 1}`,
        text: promptText,
      },
    ],
    readiness: emptyReadiness(),
    requirementAudit: emptyRequirementAudit(),
    updatedAt: new Date().toISOString(),
  };
  self.persistState();
}

function userMessageText(message: Extract<AgentMessage, { role: "user" }>): string {
  return typeof message.content === "string"
    ? message.content
    : message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
}

export function do_createToolDefinition(
  self: TaskVerificationController,
): ToolDefinition<typeof VerificationSchema, VerificationResult> {
  return {
    name: TASK_VERIFICATION_TOOL_NAME,
    label: "Task Verification",
    description:
      'Record or inspect evidence-backed baseline, final semantic verification, and finish readiness for mutating tasks. Use action "status" whenever the required next step is unclear, especially after compaction or session restore.',
    promptSnippet:
      "record_task_verification(action, ...): declare mutation intent, prove baseline and final behavior, then call ready_to_finish with requirement-to-evidence mappings before successful finish_work.",
    promptGuidelines: [
      `Call ${TASK_VERIFICATION_TOOL_NAME} with action "status" at any time to recover the exact current requirement, eligible evidence handles, and next tool-call shape. Do this after compaction or whenever a gate is unclear.`,
      `The controller automatically records mutation intent before the first mutating tool call. Use ${TASK_VERIFICATION_TOOL_NAME} with action "declare_task" only to override its classification before mutation.`,
      "Workflow steps: 1. collect the required baseline -> 2. apply file edits -> 3. rerun the exact baseline command. A successful exact replay automatically records final verification.",
      'When using static_trace for record_baseline, you MUST provide at least two non-error inspection evidence handles (e.g. evidence_refs: ["verification-evidence-1", "verification-evidence-2"]).',
      "Bug fixes, behavior changes, and refactors require evidence-backed baseline verification before production mutation.",
      'To create a failing regression test before implementation, authorize exact test paths with action "authorize_baseline_test"; only those test files may be edited until the failing focused test is recorded.',
      "Signal, restart, persistence, recovery, transaction, concurrency, migration, and indexing tasks require runtime reproduction or a failing focused regression test.",
      "Final verification must rerun the exact same reproduction command or focused regression test that established the baseline. Do not substitute static_review or generic npm run check.",
      "Evidence handles from prior mutation revisions become stale after any file edit. Re-run your verification command after editing to produce fresh handles for the current revision.",
      "When no exact baseline replay exists, record_final may omit evidence_refs and descriptive fields; the controller selects the latest eligible current-revision evidence and derives the method and observations.",
      "After final verification passes, call action 'ready_to_finish' with acceptance_checks and fresh evidence_refs. This opens finalization operations but does not issue a finish token.",
      `Then follow ${REQUIREMENT_AUDIT_TOOL_NAME}: define only user-authored requirements and record one evidence-backed verdict per model turn until every requirement has been checked.`,
      "Git commit/push require evidence readiness. Successful finish_work requires the later completion certificate and exact verification_token.",
    ],
    parameters: VerificationSchema,
    executionMode: "sequential",
    execute: async (_id, params) => {
      const result = self.applyInput(params);
      const message = result.status === "needs_action" ? self.withGuidance(result.message) : result.message;
      return { content: [{ type: "text", text: message }], details: result };
    },
  };
}

export function do_beforeToolCall(
  self: TaskVerificationController,
  context: BeforeToolCallContext,
): BeforeToolCallResult | undefined {
  const toolName = context.toolCall.name;
  if (isPublishCommand(toolName, context.args)) return self.publishGate("publish changes");
  if (
    toolName === "finish_work" &&
    argsRecord(context.args).status !== "partial" &&
    argsRecord(context.args).status !== "failed"
  ) {
    const token = argsRecord(context.args).verification_token;
    return self.completionGate("finish successfully", typeof token === "string" ? token : undefined);
  }
  if (!isPotentialMutationTool(toolName, context.args)) return undefined;
  if (!self.state.taskKind) {
    const taskSummary =
      normalizeText(self.latestUserPrompt).slice(0, 500) || "Implement the requested workspace change.";
    self.declareTask({
      action: "declare_task",
      task_kind: inferTaskKind(taskSummary),
      task_summary: taskSummary,
    });
  }
  if (self.state.baseline.required && self.state.baseline.status !== "satisfied") {
    if (isShellTool(toolName)) return undefined;
    if (self.isAuthorizedBaselineTestMutation(toolName, context.args)) return undefined;
    return self.blocked("Collect baseline evidence or authorize exact regression-test paths before implementation.");
  }
  return undefined;
}
