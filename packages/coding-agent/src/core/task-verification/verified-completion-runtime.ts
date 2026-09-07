import type {
  AfterToolCallContext,
  AfterToolCallResult,
  BeforeToolCallContext,
  FinishWorkPayload,
} from "@dst0/p-agent-core";
import type { InstalledTaskVerificationRuntime } from "../agent-session/task-verification-runtime-state.ts";
import type { AgentSession } from "../agent-session.ts";
import { resetAfterSuccessfulCompletion } from "./taskverificationcontroller-methods/completion-lifecycle.ts";
import type { VerificationResult } from "./types.ts";
import { createTaskVerificationCompletionPayload, isTaskVerificationFinalizer } from "./verified-completion.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issuedCertificateResult(
  context: AfterToolCallContext,
  runtime: InstalledTaskVerificationRuntime,
): VerificationResult | undefined {
  if (!isRecord(context.result.details)) return undefined;
  const result = context.result.details as unknown as VerificationResult;
  const current = runtime.controller.currentState;
  const issued = result.state?.readiness;
  if (
    result.status !== "updated" ||
    result.state?.taskId !== current.taskId ||
    result.state?.mutationRevision !== current.mutationRevision ||
    issued?.status !== "completion_ready" ||
    issued.token !== current.readiness?.token ||
    issued.verifiedMutationRevision !== current.readiness?.verifiedMutationRevision ||
    issued.certificateHash !== current.readiness?.certificateHash
  ) {
    return undefined;
  }
  return result;
}

function resultContent(
  context: AfterToolCallContext,
  previousResult: AfterToolCallResult | undefined,
): NonNullable<AfterToolCallResult["content"]> {
  return previousResult?.content ?? context.result.content ?? [];
}

function resultDetails(context: AfterToolCallContext, previousResult: AfterToolCallResult | undefined): unknown {
  return previousResult?.details ?? context.result.details;
}

function blockedCompletionResult(
  context: AfterToolCallContext,
  previousResult: AfterToolCallResult | undefined,
  reason: string,
): AfterToolCallResult {
  return {
    content: [
      ...resultContent(context, previousResult),
      { type: "text", text: `Verified completion blocked: ${reason}` },
    ],
    details: resultDetails(context, previousResult),
    isError: true,
    terminate: false,
  };
}

export function taskVerificationFinalizerBatchError(
  runtime: InstalledTaskVerificationRuntime,
  context: BeforeToolCallContext,
): string | undefined {
  const currentIsFinalizer = isTaskVerificationFinalizer(runtime.configuredMode, context.toolCall.name, context.args);
  const content = context.assistantMessage?.content;
  if (!Array.isArray(content)) {
    return currentIsFinalizer
      ? "A certificate-producing verification action requires complete assistant-turn context."
      : undefined;
  }
  const toolCalls = content.filter((part) => part.type === "toolCall");
  const hasFinalizer = toolCalls.some((toolCall) =>
    isTaskVerificationFinalizer(runtime.configuredMode, toolCall.name, toolCall.arguments),
  );
  if (!hasFinalizer) {
    return currentIsFinalizer
      ? "A certificate-producing verification action requires complete assistant-turn context."
      : undefined;
  }
  const includesCurrentCall = toolCalls.some(
    (toolCall) => toolCall.id === context.toolCall.id && toolCall.name === context.toolCall.name,
  );
  if (!includesCurrentCall) {
    return "A certificate-producing verification action requires complete assistant-turn context.";
  }
  return toolCalls.length === 1
    ? undefined
    : "A certificate-producing verification action must be the sole tool call in its assistant turn.";
}

export function finalizeTaskVerificationCompletion(
  session: AgentSession,
  runtime: InstalledTaskVerificationRuntime,
  context: AfterToolCallContext,
  previousResult: AfterToolCallResult | undefined,
): AfterToolCallResult | undefined {
  if (
    !isTaskVerificationFinalizer(runtime.configuredMode, context.toolCall.name, context.args) ||
    context.isError ||
    previousResult?.isError
  ) {
    return undefined;
  }
  const toolCalls = context.assistantMessage.content.filter((part) => part.type === "toolCall");
  if (toolCalls.length !== 1) {
    return blockedCompletionResult(context, previousResult, "the certificate-producing action was batched.");
  }
  const certificateResult = issuedCertificateResult(context, runtime);
  if (!certificateResult) return undefined;
  const state = certificateResult.state;
  if (state.readiness?.status !== "completion_ready" || !state.readiness.token || !state.readiness.certificateHash) {
    return undefined;
  }
  if (
    runtime.controller.activeMutationAttempts.size > 0 ||
    runtime.controller.testMutationReservations.size > 0 ||
    runtime.controller.workspaceTestSnapshots.size > 0 ||
    runtime.controller.workspaceSourceSnapshots.size > 0
  ) {
    return blockedCompletionResult(context, previousResult, "another workspace operation is still in flight.");
  }
  const completionGate = runtime.controller.completionGate(
    "finish successfully",
    state.readiness.token,
    state.taskOwnedPaths ?? [],
  );
  if (completionGate?.block) {
    return blockedCompletionResult(context, previousResult, completionGate.reason ?? "the completion gate failed.");
  }
  const verificationGate = session._verificationLedger.gate();
  if (verificationGate) {
    const failures = verificationGate.failures.map((failure) => `${failure.command} (exit ${failure.exitCode})`);
    return blockedCompletionResult(
      context,
      previousResult,
      `required verification checks still fail: ${failures.join(", ")}`,
    );
  }
  const payload = createTaskVerificationCompletionPayload(context.args, state, state.readiness.certificateHash);
  session._autoExecuteUpdateSessionState();
  const sessionStateBlock = session._getFinishWorkSessionStateBlockReason(payload);
  if (sessionStateBlock) return blockedCompletionResult(context, previousResult, sessionStateBlock);
  session._reconcileSuccessfulFinishWorkState();
  resetAfterSuccessfulCompletion(runtime.controller);
  const terminalResult: AfterToolCallResult & { completion: FinishWorkPayload } = {
    content: [
      ...resultContent(context, previousResult),
      { type: "text", text: `Verified terminal completion accepted.\n${payload.summary}` },
    ],
    details: {
      ...certificateResult,
      verifiedCompletion: payload,
    },
    isError: false,
    terminate: true,
    completion: {
      status: "success",
      summary: payload.summary,
      files_changed: payload.files_changed,
    },
  };
  return terminalResult;
}
