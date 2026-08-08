import type { AssistantMessage } from "@dst0/p-ai";
import { sleep } from "../../../utils/sleep.ts";
import { type BashResult, executeBashWithOperations } from "../../bash-executor.ts";
import { evaluateGuardrails } from "../../guardrails.ts";
import { type BashOperations, createLocalBashOperations } from "../../tools/bash.ts";
import type { AgentSession } from "../agentsession.ts";
import {
  MODEL_RECOVERY_BASE_DELAY_MS,
  MODEL_RECOVERY_MAX_RETRY_DELAY_MS,
  MODEL_RECOVERY_MIN_RETRIES,
  MODEL_RECOVERY_RETRY_PATTERN,
} from "../constants.ts";

export async function do__prepareRetry(self: AgentSession, message: AssistantMessage): Promise<boolean> {
  const settings = self.settingsManager.getRetrySettings();
  if (!settings.enabled) {
    return false;
  }
  const maxRetries = self._getEffectiveRetryMaxAttempts(message, settings.maxRetries);

  self._retryAttempt++;

  if (self._retryAttempt > maxRetries) {
    // Preserve the completed attempt count so post-run handling can emit the final failure.
    self._retryAttempt--;
    return false;
  }

  const delayMs = self._getRetryDelayMs(message, self._retryAttempt, settings.baseDelayMs);

  self._emit({
    type: "auto_retry_start",
    attempt: self._retryAttempt,
    maxAttempts: maxRetries,
    delayMs,
    errorMessage: message.errorMessage || "Unknown error",
    reason: self._getRetryReason(message),
  });

  // Remove error message from agent state (keep in session for history)
  const messages = self.agent.state.messages;
  if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
    self.agent.state.messages = messages.slice(0, -1);
  }

  // Wait with exponential backoff (abortable)
  self._retryAbortController = new AbortController();
  try {
    await sleep(delayMs, self._retryAbortController.signal);
  } catch {
    // Aborted during sleep - emit end event so UI can clean up
    const attempt = self._retryAttempt;
    self._retryAttempt = 0;
    self._emit({
      type: "auto_retry_end",
      success: false,
      attempt,
      finalError: "Retry cancelled",
    });
    return false;
  } finally {
    self._retryAbortController = undefined;
  }

  return true;
}

export function do__getEffectiveRetryMaxAttempts(
  _self: AgentSession,
  message: AssistantMessage,
  configuredMaxRetries: number,
): number {
  if (MODEL_RECOVERY_RETRY_PATTERN.test(message.errorMessage ?? "")) {
    return Math.max(configuredMaxRetries, MODEL_RECOVERY_MIN_RETRIES);
  }
  return configuredMaxRetries;
}

export function do__getRetryReason(_self: AgentSession, message: AssistantMessage): "model_loading" | "transient" {
  return MODEL_RECOVERY_RETRY_PATTERN.test(message.errorMessage ?? "") ? "model_loading" : "transient";
}

export function do__getRetryDelayMs(
  _self: AgentSession,
  message: AssistantMessage,
  attempt: number,
  baseDelayMs: number,
): number {
  if (!MODEL_RECOVERY_RETRY_PATTERN.test(message.errorMessage ?? "")) {
    return baseDelayMs * 2 ** (attempt - 1);
  }
  const modelRecoveryDelayMs = Math.max(baseDelayMs, MODEL_RECOVERY_BASE_DELAY_MS) * attempt;
  return Math.min(modelRecoveryDelayMs, MODEL_RECOVERY_MAX_RETRY_DELAY_MS);
}

export function do_abortRetry(self: AgentSession): void {
  self._retryAbortController?.abort();
}

export function do_setAutoRetryEnabled(self: AgentSession, enabled: boolean): void {
  self.settingsManager.setRetryEnabled(enabled);
}

export async function do_executeBash(
  self: AgentSession,
  command: string,
  onChunk?: (chunk: string) => void,
  options?: { excludeFromContext?: boolean; operations?: BashOperations },
): Promise<BashResult> {
  const guardrails = evaluateGuardrails({
    cwd: self._cwd,
    command,
    phase: "bash",
    recentCommands: self._recentBashCommands,
  });
  if (!guardrails.ok) {
    const blocker = guardrails.results.find((item) => !item.ok && item.severity === "critical");
    throw new Error(blocker?.message ?? "Bash command blocked by executable guardrail.");
  }
  self._bashAbortController = new AbortController();

  // Apply command prefix if configured (e.g., "shopt -s expand_aliases" for alias support)
  const prefix = self.settingsManager.getShellCommandPrefix();
  const shellPath = self.settingsManager.getShellPath();
  const resolvedCommand = prefix ? `${prefix}\n${command}` : command;

  try {
    const result = await executeBashWithOperations(
      resolvedCommand,
      self.sessionManager.getCwd(),
      options?.operations ?? createLocalBashOperations({ shellPath }),
      {
        onChunk,
        signal: self._bashAbortController.signal,
      },
    );

    self.recordBashResult(command, result, options);
    return result;
  } finally {
    self._bashAbortController = undefined;
  }
}

export function do__rememberBashCommand(self: AgentSession, command: string): void {
  self._recentBashCommands.push(command);
  if (self._recentBashCommands.length > 50) {
    self._recentBashCommands = self._recentBashCommands.slice(-50);
  }
}
