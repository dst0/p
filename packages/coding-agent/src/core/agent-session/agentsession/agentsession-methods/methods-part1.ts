import type { AgentEvent, AgentMessage, CompletionMode, ThinkingLevel } from "@dst0/p-agent-core";
import type { AssistantMessage, ImageContent, Message, Model, TextContent } from "@dst0/p-ai";
import type { ToolDefinition, ToolInfo } from "../../../extensions/index.ts";
import type { CustomMessage } from "../../../messages.ts";
import type { TokenBreakdown } from "../../../token-accounting.ts";
import type { AgentSessionEvent, AgentSessionEventListener, PromptOptions } from "../../types-part1.ts";
import type { ToolResultContextExtract } from "../../types-part2.ts";
import type { AgentSession } from "../agentsession.ts";

export async function do__getRequiredRequestAuth(
  self: AgentSession,
  model: Model<any>,
): Promise<{
  apiKey: string;
  headers?: Record<string, string>;
}> {
  return do__getRequiredRequestAuth(self, model);
}

export async function do__getCompactionRequestAuth(
  self: AgentSession,
  model: Model<any>,
): Promise<{
  apiKey?: string;
  headers?: Record<string, string>;
}> {
  return do__getCompactionRequestAuth(self, model);
}

export function do__getServiceModelRequest(
  self: AgentSession,
  minContextTokens = 0,
): {
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
} {
  return do__getServiceModelRequest(self, minContextTokens);
}

export async function do__getServiceAuthWithCurrentFallback(
  self: AgentSession,
  request: { model: Model<any>; thinkingLevel: ThinkingLevel },
): Promise<{
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  apiKey?: string;
  headers?: Record<string, string>;
}> {
  return do__getServiceAuthWithCurrentFallback(self, request);
}

export function do__getFastResponderModelRequest(self: AgentSession):
  | {
      model: Model<string>;
      thinkingLevel: ThinkingLevel;
    }
  | undefined {
  return do__getFastResponderModelRequest(self);
}

export function do__shouldRunFastResponder(self: AgentSession, messages: AgentMessage[]): boolean {
  return do__shouldRunFastResponder(self, messages);
}

export async function do__createFastResponderMessage(
  self: AgentSession,
  userText: string,
  messages: AgentMessage[],
): Promise<CustomMessage<{ model: string; contextTokens: number }> | undefined> {
  return do__createFastResponderMessage(self, userText, messages);
}

export async function do__maybeCreateToolResultContextExtract(
  self: AgentSession,
  toolName: string,
  content: (TextContent | ImageContent)[],
  details: unknown,
  isError: boolean,
  contextMessages: AgentMessage[],
  signal?: AbortSignal,
): Promise<ToolResultContextExtract | undefined> {
  return do__maybeCreateToolResultContextExtract(self, toolName, content, details, isError, contextMessages, signal);
}

export function do__installAgentToolHooks(self: AgentSession): void {
  do__installAgentToolHooks(self);
}

export function do__getFinishWorkSessionStateBlockReason(self: AgentSession, args: unknown): string | undefined {
  return do__getFinishWorkSessionStateBlockReason(self, args);
}

export function do__emit(self: AgentSession, event: AgentSessionEvent): void {
  do__emit(self, event);
}

export function do__emitQueueUpdate(self: AgentSession): void {
  do__emitQueueUpdate(self);
}

export function do__willRetryAfterAgentEnd(
  self: AgentSession,
  event: Extract<AgentEvent, { type: "agent_end" }>,
): boolean {
  return do__willRetryAfterAgentEnd(self, event);
}

export function do__isContextOverflowForCurrentModel(self: AgentSession, message: AssistantMessage): boolean {
  return do__isContextOverflowForCurrentModel(self, message);
}

export function do__removeContextOverflowMessages(self: AgentSession, messages: AgentMessage[]): AgentMessage[] {
  return do__removeContextOverflowMessages(self, messages);
}

export function do__shouldHideContextOverflowMessage(self: AgentSession, message: AssistantMessage): boolean {
  return do__shouldHideContextOverflowMessage(self, message);
}

export function do__getUserMessageText(self: AgentSession, message: Message): string {
  return do__getUserMessageText(self, message);
}

export function do__findLastAssistantMessage(self: AgentSession): AssistantMessage | undefined {
  return do__findLastAssistantMessage(self);
}

export function do__replaceMessageInPlace(self: AgentSession, target: AgentMessage, replacement: AgentMessage): void {
  do__replaceMessageInPlace(self, target, replacement);
}

export function do__getAssistantMessageText(self: AgentSession, message: AssistantMessage): string {
  return do__getAssistantMessageText(self, message);
}

export function do__replaceAssistantMessageText(
  self: AgentSession,
  message: AssistantMessage,
  text: string,
): AssistantMessage {
  return do__replaceAssistantMessageText(self, message, text);
}

export function do__applyAssistantSessionStateUpdate(
  self: AgentSession,
  rawAssistantText: string,
  sourceEntryId: string,
): void {
  do__applyAssistantSessionStateUpdate(self, rawAssistantText, sourceEntryId);
}

export async function do__emitExtensionEvent(self: AgentSession, event: AgentEvent): Promise<void> {
  return do__emitExtensionEvent(self, event);
}

export function do_subscribe(self: AgentSession, listener: AgentSessionEventListener): () => void {
  return do_subscribe(self, listener);
}

export function do__disconnectFromAgent(self: AgentSession): void {
  do__disconnectFromAgent(self);
}

export function do__reconnectToAgent(self: AgentSession): void {
  do__reconnectToAgent(self);
}

export function do_dispose(self: AgentSession): void {
  do_dispose(self);
}

export function do_getLastTokenBreakdown(self: AgentSession): TokenBreakdown | undefined {
  return do_getLastTokenBreakdown(self);
}

export function do_willRetryMessage(self: AgentSession, message: AssistantMessage): boolean {
  return do_willRetryMessage(self, message);
}

export function do_getActiveToolNames(self: AgentSession): string[] {
  return do_getActiveToolNames(self);
}

export function do_getAllTools(self: AgentSession): ToolInfo[] {
  return do_getAllTools(self);
}

export function do_getToolDefinition(self: AgentSession, name: string): ToolDefinition | undefined {
  return do_getToolDefinition(self, name);
}

export function do_setActiveToolsByName(self: AgentSession, toolNames: string[]): void {
  do_setActiveToolsByName(self, toolNames);
}

export function do_enablePlanMode(self: AgentSession): { enabled: boolean; missingTools: string[] } {
  return do_enablePlanMode(self);
}

export function do_disablePlanMode(self: AgentSession): void {
  do_disablePlanMode(self);
}

export function do_setScopedModels(
  self: AgentSession,
  scopedModels: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>,
): void {
  do_setScopedModels(self, scopedModels);
}

export function do__normalizePromptSnippet(self: AgentSession, text: string | undefined): string | undefined {
  return do__normalizePromptSnippet(self, text);
}

export function do__normalizePromptGuidelines(self: AgentSession, guidelines: string[] | undefined): string[] {
  return do__normalizePromptGuidelines(self, guidelines);
}

export function do__getEffectiveCompletionModeForActiveTools(
  self: AgentSession,
  activeToolCount: number,
): CompletionMode {
  return do__getEffectiveCompletionModeForActiveTools(self, activeToolCount);
}

export function do__getInteractionModeSystemPrompt(self: AgentSession): string | undefined {
  return do__getInteractionModeSystemPrompt(self);
}

export function do__rebuildSystemPrompt(
  self: AgentSession,
  toolNames: string[],
  completionMode = self._getEffectiveCompletionModeForActiveTools(toolNames.length),
): string {
  return do__rebuildSystemPrompt(self, toolNames, completionMode);
}

export async function do__runAgentPrompt(self: AgentSession, messages: AgentMessage | AgentMessage[]): Promise<void> {
  return do__runAgentPrompt(self, messages);
}

export async function do__handlePostAgentRun(self: AgentSession): Promise<boolean> {
  return do__handlePostAgentRun(self);
}

export async function do_prompt(self: AgentSession, text: string, options?: PromptOptions): Promise<void> {
  return do_prompt(self, text, options);
}
