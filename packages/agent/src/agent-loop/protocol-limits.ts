import type { CompletionMode } from "../completion-protocol.ts";
import type { AgentLoopConfig } from "../types.ts";
import {
  DEFAULT_MAX_CONSECUTIVE_WAITING_TURNS,
  DEFAULT_MAX_EMPTY_ASSISTANT_RETRIES,
  DEFAULT_MAX_EXPLICIT_MISSING_FINISH_RETRIES,
  DEFAULT_MAX_MALFORMED_TOOL_RETRIES,
  DEFAULT_MAX_MISSING_FINISH_RETRIES,
  DEFAULT_MAX_NO_PROGRESS_TURNS,
  DEFAULT_MAX_TURNS,
} from "./constants.ts";
import type { CompletionProtocolLimits, CompletionProtocolRepair, CompletionProtocolState } from "./types.ts";

/** Explicit completion keeps an unbounded turn budget but bounds repairs and turns without progress. */
export function resolveCompletionLimits(config: AgentLoopConfig, mode: CompletionMode): CompletionProtocolLimits {
  const defaultMissingFinishRetries =
    mode === "explicit_finish" ? DEFAULT_MAX_EXPLICIT_MISSING_FINISH_RETRIES : DEFAULT_MAX_MISSING_FINISH_RETRIES;
  return {
    maxTurns: config.completionLimits?.maxTurns ?? DEFAULT_MAX_TURNS,
    maxNoProgressTurns: config.completionLimits?.maxNoProgressTurns ?? DEFAULT_MAX_NO_PROGRESS_TURNS,
    maxConsecutiveWaitingTurns:
      config.completionLimits?.maxConsecutiveWaitingTurns ?? DEFAULT_MAX_CONSECUTIVE_WAITING_TURNS,
    maxMalformedToolRetries: config.completionLimits?.maxMalformedToolRetries ?? DEFAULT_MAX_MALFORMED_TOOL_RETRIES,
    maxEmptyAssistantRetries: config.completionLimits?.maxEmptyAssistantRetries ?? DEFAULT_MAX_EMPTY_ASSISTANT_RETRIES,
    maxMissingFinishRetries: config.completionLimits?.maxMissingFinishRetries ?? defaultMissingFinishRetries,
  };
}

/**
 * The user-facing reason to stop a protocol run whose repair limits are exhausted, or undefined to continue.
 * Explicit completion stops after repeated text-only answers instead of repairing without bound.
 */
export function protocolLimitDiagnostic(
  state: CompletionProtocolState,
  limits: CompletionProtocolLimits,
  mode: CompletionMode,
  repair: CompletionProtocolRepair | undefined,
): string | undefined {
  if (state.malformedToolRetries > limits.maxMalformedToolRetries) {
    return repair?.reason === "repetitive_model_output"
      ? `Agent stopped because the model entered a repetitive output loop ${state.malformedToolRetries} times.`
      : `Agent stopped because the provider repeatedly reported tool use without returning a valid tool call after ${state.malformedToolRetries} attempts.`;
  }
  if (state.emptyAssistantRetries > limits.maxEmptyAssistantRetries) {
    return `Agent stopped because the provider returned ${state.emptyAssistantRetries} empty responses without a valid tool call.`;
  }
  if (mode === "explicit_finish" && state.missingFinishRetries > limits.maxMissingFinishRetries) {
    return `Agent stopped because the model answered ${state.missingFinishRetries} times in a row without calling \`finish_work\` to complete the task. Its last answer is shown above; reply to continue.`;
  }
  if (state.noProgressTurns > limits.maxNoProgressTurns) {
    return `Agent stopped because the model did not call \`finish_work\` and made no progress for ${state.noProgressTurns} turns.`;
  }
  return undefined;
}
