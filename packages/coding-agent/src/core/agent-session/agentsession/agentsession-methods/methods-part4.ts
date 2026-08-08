import type { AgentMessage } from "@dst0/p-agent-core";
import type { AssistantMessage } from "@dst0/p-ai";
import type { BashResult } from "../../../bash-executor.ts";
import type { ContextUsage, ReplacedSessionContext } from "../../../extensions/index.ts";
import type { BranchSummaryEntry } from "../../../session-manager.ts";
import type { BashOperations } from "../../../tools/bash.ts";
import type { SessionStats } from "../../types-part1.ts";
import type { AgentSession } from "../agentsession.ts";

export function do__isNonRetryableProviderLimitError(self: AgentSession, errorMessage: string): boolean {
  return do__isNonRetryableProviderLimitError(self, errorMessage);
}

export function do__isRetryableError(self: AgentSession, message: AssistantMessage): boolean {
  return do__isRetryableError(self, message);
}

export async function do__prepareRetry(self: AgentSession, message: AssistantMessage): Promise<boolean> {
  return do__prepareRetry(self, message);
}

export function do__getEffectiveRetryMaxAttempts(
  self: AgentSession,
  message: AssistantMessage,
  configuredMaxRetries: number,
): number {
  return do__getEffectiveRetryMaxAttempts(self, message, configuredMaxRetries);
}

export function do__getRetryReason(self: AgentSession, message: AssistantMessage): "model_loading" | "transient" {
  return do__getRetryReason(self, message);
}

export function do__getRetryDelayMs(
  self: AgentSession,
  message: AssistantMessage,
  attempt: number,
  baseDelayMs: number,
): number {
  return do__getRetryDelayMs(self, message, attempt, baseDelayMs);
}

export function do_abortRetry(self: AgentSession): void {
  do_abortRetry(self);
}

export function do_setAutoRetryEnabled(self: AgentSession, enabled: boolean): void {
  do_setAutoRetryEnabled(self, enabled);
}

export async function do_executeBash(
  self: AgentSession,
  command: string,
  onChunk?: (chunk: string) => void,
  options?: { excludeFromContext?: boolean; operations?: BashOperations },
): Promise<BashResult> {
  return do_executeBash(self, command, onChunk, options);
}

export function do__rememberBashCommand(self: AgentSession, command: string): void {
  do__rememberBashCommand(self, command);
}

export function do_recordBashResult(
  self: AgentSession,
  command: string,
  result: BashResult,
  options?: { excludeFromContext?: boolean },
): void {
  do_recordBashResult(self, command, result, options);
}

export function do_abortBash(self: AgentSession): void {
  do_abortBash(self);
}

export function do__flushPendingBashMessages(self: AgentSession): void {
  do__flushPendingBashMessages(self);
}

export function do_setSessionName(self: AgentSession, name: string): void {
  do_setSessionName(self, name);
}

export async function do_navigateTree(
  self: AgentSession,
  targetId: string,
  options: {
    summarize?: boolean;
    customInstructions?: string;
    replaceInstructions?: boolean;
    label?: string;
  } = {},
): Promise<{
  editorText?: string;
  cancelled: boolean;
  aborted?: boolean;
  summaryEntry?: BranchSummaryEntry;
}> {
  return do_navigateTree(self, targetId, options);
}

export function do_getUserMessagesForForking(self: AgentSession): Array<{ entryId: string; text: string }> {
  return do_getUserMessagesForForking(self);
}

export function do__extractUserMessageText(
  self: AgentSession,
  content: string | Array<{ type: string; text?: string }>,
): string {
  return do__extractUserMessageText(self, content);
}

export function do_getSessionStats(self: AgentSession): SessionStats {
  return do_getSessionStats(self);
}

export function do__getEffectiveCompactedMessages(self: AgentSession): AgentMessage[] {
  return do__getEffectiveCompactedMessages(self);
}

export function do__getLatestCompactionTimestamp(self: AgentSession): number | undefined {
  return do__getLatestCompactionTimestamp(self);
}

export function do_getContextUsage(self: AgentSession): ContextUsage | undefined {
  return do_getContextUsage(self);
}

export async function do_exportToHtml(self: AgentSession, outputPath?: string): Promise<string> {
  return do_exportToHtml(self, outputPath);
}

export function do_exportToJsonl(self: AgentSession, outputPath?: string): string {
  return do_exportToJsonl(self, outputPath);
}

export function do_getLastAssistantText(self: AgentSession): string | undefined {
  return do_getLastAssistantText(self);
}

export function do_createReplacedSessionContext(self: AgentSession): ReplacedSessionContext {
  return do_createReplacedSessionContext(self);
}

export function do_hasExtensionHandlers(self: AgentSession, eventType: string): boolean {
  return do_hasExtensionHandlers(self, eventType);
}
