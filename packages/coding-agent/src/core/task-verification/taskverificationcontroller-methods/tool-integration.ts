import type {
  AfterToolCallResult,
  Agent,
  AgentMessage,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "@dst0/p-agent-core";
import type { ToolDefinition } from "../../extensions/types.ts";
import { captureWorkspaceFingerprint } from "../../workspace-fingerprint.ts";
import { REQUIREMENT_AUDIT_TOOL_NAME, TASK_VERIFICATION_TOOL_NAME, VerificationSchema } from "../constants.ts";
import { isSafePublishCommandSequence } from "../git-command-classification.ts";
import { rejectedDefinitionNextActionGuardMessage } from "../requirement-definition-repair.ts";
import { emptyReadiness, emptyRequirementAudit } from "../state-factories.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import {
  argsRecord,
  inferTaskKind,
  isDirectMutationTool,
  isPotentialMutationTool,
  isPublishCommand,
  isRecord,
  isShellTool,
  normalizeText,
  pathArgument,
  shellCommand,
} from "../tool-classification.ts";
import type { VerificationResult } from "../types.ts";
import { requirementProofCommandGate } from "./requirement-proof-command-gate.ts";
import { canPotentiallyChangeWorkspace, requirementSourceMutationGate } from "./requirement-source-gate.ts";
import { captureSourceWorkspaceSnapshot } from "./source-workspace-snapshot.ts";
import {
  captureTestVerificationStart,
  releaseTestMutationReservation,
  reserveTestMutation,
  unverifiedTestPathsGate,
} from "./test-authoring-gate.ts";
import { focusedTestInvocation } from "./test-command-invocation.ts";
import { captureTestWorkspaceSnapshot } from "./test-workspace-snapshot.ts";

const NON_REQUIREMENT_NUDGE_PATTERN =
  /^(?:(?:any\s+)?(?:progress|status|update)|so|how(?:'s|\s+is)\s+it\s+going|where\s+are\s+we|what(?:'s|\s+is)\s+the\s+status|(?:please\s+)?(?:continue|proceed|go\s+on|keep\s+going|carry\s+on)|(?:please\s+)?(?:report|show|give\s+me)\s+(?:the\s+)?(?:progress|status|update))\s*[?!.]*$/iu;
const COMPLETION_NUDGE_PATTERN =
  /^are\s+you\s+(?:done|finished)(?:\s+with\s+(?:the\s+)?task)?\s+or\s+is\s+there\s+(?:anything|something)\s+left\s*[?!.]*\s*if\s+you\s+are\s+finished\s*,?\s*(?:ensure|make\s+sure)(?:\s+that)?\s+all\s+requirements\s+(?:are\s+)?(?:satisfied|met)(?:\s+and\s+(?:create|write)\s+[\p{L}\p{N}_./-]+\.(?:adoc|md|mdx|rst|txt))?\s*[?!.]*$/iu;
const NUDGE_DOCUMENT_PATH_PATTERN = /[\p{L}\p{N}_./-]+\.(?:adoc|md|mdx|rst|txt)\b/giu;

export function do_install(self: TaskVerificationController, agent: Agent): void {
  if (self.installed) return;
  self.installed = true;
  const previousBeforeToolCall = agent.beforeToolCall;
  const previousAfterToolCall = agent.afterToolCall;

  agent.beforeToolCall = async (context, signal) => {
    const verificationGate = self.beforeToolCall(context);
    if (verificationGate?.block) return verificationGate;
    let previousResult: BeforeToolCallResult | undefined;
    try {
      previousResult = await previousBeforeToolCall?.(context, signal);
    } catch (error) {
      releaseTestMutationReservation(self, context.toolCall.id);
      throw error;
    }
    if (previousResult?.block) {
      releaseTestMutationReservation(self, context.toolCall.id);
      return previousResult;
    }
    const testInvocation = isShellTool(context.toolCall.name)
      ? focusedTestInvocation(shellCommand(context.args))
      : undefined;
    const mutationAttempt = canPotentiallyChangeWorkspace(context.toolCall.name, context.args) && !testInvocation;
    if (mutationAttempt) {
      self.activeMutationAttempts.add(context.toolCall.id);
      self.mutationAttemptRevision += 1;
    }
    if (isShellTool(context.toolCall.name) && !isPublishCommand(context.toolCall.name, context.args)) {
      captureTestVerificationStart(self, context);
      const [fingerprint, testSnapshot, sourceSnapshot] = await Promise.all([
        captureWorkspaceFingerprint(self.sessionManager.getCwd()),
        captureTestWorkspaceSnapshot(self.sessionManager.getCwd()),
        mutationAttempt ? captureSourceWorkspaceSnapshot(self.sessionManager.getCwd()) : undefined,
      ]);
      self.bashFingerprints.set(context.toolCall.id, fingerprint);
      self.workspaceTestSnapshots.set(context.toolCall.id, testSnapshot);
      if (mutationAttempt) {
        self.workspaceSourceSnapshots.set(context.toolCall.id, sourceSnapshot);
      }
    } else if (mutationAttempt && (!isDirectMutationTool(context.toolCall.name) || !pathArgument(context.args))) {
      const [testSnapshot, sourceSnapshot] = await Promise.all([
        captureTestWorkspaceSnapshot(self.sessionManager.getCwd()),
        captureSourceWorkspaceSnapshot(self.sessionManager.getCwd()),
      ]);
      self.workspaceTestSnapshots.set(context.toolCall.id, testSnapshot);
      self.workspaceSourceSnapshots.set(context.toolCall.id, sourceSnapshot);
    }
    return previousResult;
  };

  agent.afterToolCall = async (context, signal) => {
    let previousFailed = false;
    let previousError: unknown;
    let previousResult: AfterToolCallResult | undefined;
    try {
      previousResult = await previousAfterToolCall?.(context, signal);
    } catch (error) {
      previousFailed = true;
      previousError = error;
    }
    try {
      const result = await self.afterToolCall(context, previousResult);
      if (previousFailed) throw previousError;
      return result;
    } catch (controllerError) {
      if (previousFailed && controllerError !== previousError) {
        if (previousError instanceof Error && previousError.cause === undefined) previousError.cause = controllerError;
        throw previousError;
      }
      throw controllerError;
    } finally {
      releaseTestMutationReservation(self, context.toolCall.id);
    }
  };

  agent.subscribe((event) => {
    if (event.type === "turn_start") {
      self.testMutationReservations.clear();
      self.testVerificationStarts.clear();
      self.workspaceTestSnapshots.clear();
      self.workspaceSourceSnapshots.clear();
      self.activeMutationAttempts.clear();
      self.bashFingerprints.clear();
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
  if (isNonRequirementNudge(promptText, taskPrompts)) return;
  self.rejectedRequirementDefinitionDraft = undefined;
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

function isNonRequirementNudge(promptText: string, taskPrompts: readonly { text: string }[]): boolean {
  const normalized = promptText.trim();
  if (NON_REQUIREMENT_NUDGE_PATTERN.test(normalized)) return true;
  if (!COMPLETION_NUDGE_PATTERN.test(normalized) || taskPrompts.length === 0) return false;
  const priorText = taskPrompts
    .map((prompt) => prompt.text)
    .join("\n")
    .toLowerCase();
  const mentionedPaths = [...normalized.matchAll(NUDGE_DOCUMENT_PATH_PATTERN)].map((match) => match[0].toLowerCase());
  return mentionedPaths.every((path) => priorText.includes(path));
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
      "Complete all requested file deliverables before final verification; any later write or edit advances the mutation revision and invalidates earlier evidence and readiness.",
      "When no exact baseline replay exists, record_final may omit evidence_refs and descriptive fields; the controller selects the latest eligible current-revision evidence and derives the method and observations.",
      "After final verification passes, call action 'ready_to_finish' with acceptance_checks and fresh evidence_refs. This opens finalization operations but does not issue a finish token.",
      `Then follow ${REQUIREMENT_AUDIT_TOOL_NAME}: define only user-authored requirements, then record one complete evidence-backed verdict batch covering every requirement.`,
      "Git commit/push require evidence readiness. Successful finish_work requires the later completion certificate and exact verification_token.",
    ],
    parameters: VerificationSchema,
    executionMode: "sequential",
    execute: async (_id, params) => {
      if (params.action !== "status" && self.rejectedRequirementDefinitionDraft) {
        const result = self.rejected(rejectedDefinitionNextActionGuardMessage(self.rejectedRequirementDefinitionDraft));
        return { content: [{ type: "text", text: result.message }], details: result };
      }
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
  if (isPublishCommand(toolName, context.args)) {
    if (!isSafePublishCommandSequence(shellCommand(context.args))) {
      return self.blocked(
        "Cannot combine a workspace mutation with git commit or push; run them as separate commands.",
      );
    }
    return unverifiedTestPathsGate(self, "publish changes") ?? self.publishGate("publish changes");
  }
  if (
    toolName === "finish_work" &&
    argsRecord(context.args).status !== "partial" &&
    argsRecord(context.args).status !== "failed"
  ) {
    const testPathsGate = unverifiedTestPathsGate(self, "finish successfully");
    if (testPathsGate) return testPathsGate;
    const token = argsRecord(context.args).verification_token;
    const gate = self.completionGate("finish successfully", typeof token === "string" ? token : undefined);
    if (gate) return gate;
    if (isRecord(context.args) && typeof context.args.verification_token !== "string") {
      const readinessToken = self.state.readiness?.token;
      if (readinessToken) {
        context.args.verification_token = readinessToken;
      }
    }
    return undefined;
  }
  if (self.restoreError && canPotentiallyChangeWorkspace(toolName, context.args)) {
    return self.blocked(`Cannot change the workspace: ${self.restoreError}.`);
  }
  if (self.rejectedRequirementDefinitionDraft && canPotentiallyChangeWorkspace(toolName, context.args)) {
    return self.blocked(rejectedDefinitionNextActionGuardMessage(self.rejectedRequirementDefinitionDraft));
  }
  if (canPotentiallyChangeWorkspace(toolName, context.args) && !self.state.taskKind) {
    const taskSummary =
      normalizeText(self.latestUserPrompt).slice(0, 500) || "Implement the requested workspace change.";
    self.declareTask({
      action: "declare_task",
      task_kind: inferTaskKind(taskSummary),
      task_summary: taskSummary,
    });
  }
  const sourceGate = requirementSourceMutationGate(self, toolName, context.args);
  if (sourceGate) return sourceGate;
  const proofCommandGate = requirementProofCommandGate(self, toolName, context.args);
  if (proofCommandGate) return proofCommandGate;
  if (!isPotentialMutationTool(toolName, context.args)) return undefined;
  if (self.state.baseline.required && self.state.baseline.status !== "satisfied") {
    if (isShellTool(toolName)) return undefined;
    if (self.isAuthorizedBaselineTestMutation(toolName, context.args)) return undefined;
    return self.blocked("Collect baseline evidence or authorize exact regression-test paths before implementation.");
  }
  return reserveTestMutation(self, context);
}
