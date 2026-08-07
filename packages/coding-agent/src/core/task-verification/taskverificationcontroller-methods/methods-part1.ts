import type { Agent, BeforeToolCallContext, BeforeToolCallResult } from "@dst0/p-agent-core";
import type { ToolDefinition } from "../../extensions/types.ts";
import { captureWorkspaceFingerprint } from "../../workspace-fingerprint.ts";
import { TASK_VERIFICATION_TOOL_NAME, VerificationSchema } from "../constants.ts";
import {
  argsRecord,
  emptyState,
  inferTaskKind,
  isPotentialMutationTool,
  isPublishCommand,
  isShellTool,
  normalizeText,
} from "../helpers-part1.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
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
    if (event.type !== "message_start" || event.message.role !== "user") return;
    const content = event.message.content;
    const promptText =
      typeof content === "string"
        ? content
        : content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n");
    self.latestUserPrompt = promptText;
    const cleanPrompt = normalizeText(promptText);
    if (cleanPrompt) {
      if (!self.state.taskPrompts) {
        self.state.taskPrompts = [];
      }
      if (!self.state.taskPrompts.includes(cleanPrompt)) {
        self.state.taskPrompts.push(cleanPrompt);
      }
    }
    if (self.state.final.status === "passed") {
      self.state = emptyState();
      if (cleanPrompt) {
        self.state.taskPrompts = [cleanPrompt];
      }
      self.persistState();
    }
  });
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
      `Call ${TASK_VERIFICATION_TOOL_NAME} with action "status" at any time to recover the exact current requirement, eligible evidence handles, and next tool-call shape. Do self after compaction or whenever a gate is unclear.`,
      `The controller automatically records mutation intent before the first mutating tool call. Use ${TASK_VERIFICATION_TOOL_NAME} with action "declare_task" only to override its classification before mutation.`,
      "Workflow steps: 1. collect the required baseline -> 2. apply file edits -> 3. rerun the exact baseline command. A successful exact replay automatically records final verification.",
      'When using static_trace for record_baseline, you MUST provide at least two non-error inspection evidence handles (e.g. evidence_refs: ["verification-evidence-1", "verification-evidence-2"]).',
      "Bug fixes, behavior changes, and refactors require evidence-backed baseline verification before production mutation.",
      'To create a failing regression test before implementation, authorize exact test paths with action "authorize_baseline_test"; only those test files may be edited until the failing focused test is recorded.',
      "Signal, restart, persistence, recovery, transaction, concurrency, migration, and indexing tasks require runtime reproduction or a failing focused regression test.",
      "Final verification must rerun the exact same reproduction command or focused regression test that established the baseline. Do not substitute static_review or generic npm run check.",
      "Evidence handles from prior mutation revisions become stale after any file edit. Re-run your verification command after editing to produce fresh handles for the current revision.",
      "When no exact baseline replay exists, record_final may omit evidence_refs and descriptive fields; the controller selects the latest eligible current-revision evidence and derives the method and observations.",
      "After final verification passes, call action 'ready_to_finish' with one acceptance_checks entry for every explicit requirement and fresh evidence_refs proving it.",
      "Successful finish_work and git commit/push are blocked until ready_to_finish issues a readiness certificate for the current mutation revision.",
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
  if (isPublishCommand(toolName, context.args)) return self.finalGate("publish changes");
  if (
    toolName === "finish_work" &&
    argsRecord(context.args).status !== "partial" &&
    argsRecord(context.args).status !== "failed"
  ) {
    const token = argsRecord(context.args).verification_token;
    return self.finalGate("finish successfully", typeof token === "string" ? token : undefined, true);
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
