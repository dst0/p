import type { AgentMessage, ThinkingLevel } from "@dst0/p-agent-core";
import type { ImageContent, Model, TextContent } from "@dst0/p-ai";
import type { StructuredSessionState } from "../../../compaction/index.ts";
import type { CustomMessage } from "../../../messages.ts";
import type {
  ProjectMemoryDiffResult,
  ProjectMemoryInitResult,
  ProjectMemoryPinResult,
  ProjectMemorySearchResult,
  ProjectMemoryUpdateResult,
} from "../../../project-memory.ts";
import type { SessionEntry } from "../../../session-manager.ts";
import type { TokenBreakdown } from "../../../token-accounting.ts";
import type { ModelCycleResult, SessionStateSnapshot } from "../../types-part1.ts";
import type {
  PromptContextPreparation,
  RuntimeContextPrompts,
  WorkingStatePromptInsertionOptions,
} from "../../types-part2.ts";
import type { AgentSession } from "../agentsession.ts";

export async function do__tryExecuteExtensionCommand(self: AgentSession, text: string): Promise<boolean> {
  return do__tryExecuteExtensionCommand(self, text);
}

export function do__expandSkillCommand(self: AgentSession, text: string): string {
  return do__expandSkillCommand(self, text);
}

export async function do_steer(self: AgentSession, text: string, images?: ImageContent[]): Promise<void> {
  return do_steer(self, text, images);
}

export async function do_followUp(self: AgentSession, text: string, images?: ImageContent[]): Promise<void> {
  return do_followUp(self, text, images);
}

export async function do__queueSteer(self: AgentSession, text: string, images?: ImageContent[]): Promise<void> {
  return do__queueSteer(self, text, images);
}

export async function do__queueFollowUp(self: AgentSession, text: string, images?: ImageContent[]): Promise<void> {
  return do__queueFollowUp(self, text, images);
}

export function do__throwIfExtensionCommand(self: AgentSession, text: string): void {
  do__throwIfExtensionCommand(self, text);
}

export async function do_sendCustomMessage<T = unknown>(
  self: AgentSession,
  message: Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">,
  options?: {
    triggerTurn?: boolean;
    deliverAs?: "steer" | "followUp" | "nextTurn";
  },
): Promise<void> {
  return do_sendCustomMessage(self, message, options);
}

export async function do_sendUserMessage(
  self: AgentSession,
  content: string | (TextContent | ImageContent)[],
  options?: { deliverAs?: "steer" | "followUp" },
): Promise<void> {
  return do_sendUserMessage(self, content, options);
}

export function do_clearQueue(self: AgentSession): { steering: string[]; followUp: string[] } {
  return do_clearQueue(self);
}

export function do_getSteeringMessages(self: AgentSession): readonly string[] {
  return do_getSteeringMessages(self);
}

export function do_getFollowUpMessages(self: AgentSession): readonly string[] {
  return do_getFollowUpMessages(self);
}

export async function do_abort(self: AgentSession): Promise<void> {
  return do_abort(self);
}

export async function do__emitModelSelect(
  self: AgentSession,
  nextModel: Model<any>,
  previousModel: Model<any> | undefined,
  source: "set" | "cycle" | "restore",
): Promise<void> {
  return do__emitModelSelect(self, nextModel, previousModel, source);
}

export async function do_setModel(self: AgentSession, model: Model<any>): Promise<void> {
  return do_setModel(self, model);
}

export async function do_cycleModel(
  self: AgentSession,
  direction: "forward" | "backward" = "forward",
): Promise<ModelCycleResult | undefined> {
  return do_cycleModel(self, direction);
}

export async function do__cycleScopedModel(
  self: AgentSession,
  direction: "forward" | "backward",
): Promise<ModelCycleResult | undefined> {
  return do__cycleScopedModel(self, direction);
}

export async function do__cycleAvailableModel(
  self: AgentSession,
  direction: "forward" | "backward",
): Promise<ModelCycleResult | undefined> {
  return do__cycleAvailableModel(self, direction);
}

export function do_setThinkingLevel(self: AgentSession, level: ThinkingLevel): void {
  do_setThinkingLevel(self, level);
}

export function do_cycleThinkingLevel(self: AgentSession): ThinkingLevel | undefined {
  return do_cycleThinkingLevel(self);
}

export function do_getAvailableThinkingLevels(self: AgentSession): ThinkingLevel[] {
  return do_getAvailableThinkingLevels(self);
}

export function do_supportsThinking(self: AgentSession): boolean {
  return do_supportsThinking(self);
}

export function do__getThinkingLevelForModelSwitch(self: AgentSession, explicitLevel?: ThinkingLevel): ThinkingLevel {
  return do__getThinkingLevelForModelSwitch(self, explicitLevel);
}

export function do__clampThinkingLevel(
  self: AgentSession,
  level: ThinkingLevel,
  _availableLevels: ThinkingLevel[],
): ThinkingLevel {
  return do__clampThinkingLevel(self, level, _availableLevels);
}

export function do_syncQueueModesFromSettings(self: AgentSession): void {
  do_syncQueueModesFromSettings(self);
}

export function do_setSteeringMode(self: AgentSession, mode: "all" | "one-at-a-time"): void {
  do_setSteeringMode(self, mode);
}

export function do_setFollowUpMode(self: AgentSession, mode: "all" | "one-at-a-time"): void {
  do_setFollowUpMode(self, mode);
}

export function do_getSessionStateSnapshot(self: AgentSession): SessionStateSnapshot {
  return do_getSessionStateSnapshot(self);
}

export function do__getCurrentStructuredSessionState(
  self: AgentSession,
  branchEntries = self.sessionManager.getBranch(),
): StructuredSessionState {
  return do__getCurrentStructuredSessionState(self, branchEntries);
}

export function do__getLiveStateFallbackEntries(self: AgentSession, branchEntries: SessionEntry[]): SessionEntry[] {
  return do__getLiveStateFallbackEntries(self, branchEntries);
}

export function do__createLiveStructuredSessionState(
  self: AgentSession,
  branchEntries: SessionEntry[],
  previous?: StructuredSessionState,
): StructuredSessionState {
  return do__createLiveStructuredSessionState(self, branchEntries, previous);
}

export function do__syncProjectMemory(self: AgentSession): void {
  do__syncProjectMemory(self);
}

export function do__createProjectMemoryPrompt(self: AgentSession, query: string): string | undefined {
  return do__createProjectMemoryPrompt(self, query);
}

export function do__createRuntimeContextPrompts(
  self: AgentSession,
  query: string,
  baseSystemPrompt: string,
  pendingMessages: AgentMessage[] = [],
): RuntimeContextPrompts {
  return do__createRuntimeContextPrompts(self, query, baseSystemPrompt, pendingMessages);
}

export function do__withPendingMessageEntries(
  self: AgentSession,
  branchEntries: SessionEntry[],
  pendingMessages: AgentMessage[],
): SessionEntry[] {
  return do__withPendingMessageEntries(self, branchEntries, pendingMessages);
}

export function do__createToolPromptAccountingText(self: AgentSession): string {
  return do__createToolPromptAccountingText(self);
}

export function do__installPromptContextTransform(self: AgentSession): void {
  do__installPromptContextTransform(self);
}

export function do__createWorkingStatePromptMessage(
  self: AgentSession,
  content: string,
  timestamp: number,
): CustomMessage {
  return do__createWorkingStatePromptMessage(self, content, timestamp);
}

export function do__createRuntimeContextPromptMessage(
  self: AgentSession,
  content: string,
  timestamp: number,
): CustomMessage {
  return do__createRuntimeContextPromptMessage(self, content, timestamp);
}

export function do__withWorkingStatePromptInsertions(
  self: AgentSession,
  messages: AgentMessage[],
  workingStatePrompt: string | undefined,
  options: WorkingStatePromptInsertionOptions = {},
): AgentMessage[] {
  return do__withWorkingStatePromptInsertions(self, messages, workingStatePrompt, options);
}

export function do__preparePromptContext(
  self: AgentSession,
  messages: AgentMessage[],
  systemPrompt = self.systemPrompt,
  options: { recordWorkingState?: boolean } = {},
): PromptContextPreparation {
  return do__preparePromptContext(self, messages, systemPrompt, options);
}

export function do__createTokenBreakdownForPrompt(
  self: AgentSession,
  messages: AgentMessage[],
  options: {
    totalOverride?: number;
    source?: "provider_usage" | "estimated";
    toolRawTokens?: number;
  } = {},
): TokenBreakdown {
  return do__createTokenBreakdownForPrompt(self, messages, options);
}

export function do_initProjectMemory(self: AgentSession): ProjectMemoryInitResult {
  return do_initProjectMemory(self);
}

export function do_syncProjectMemory(self: AgentSession): ProjectMemoryUpdateResult {
  return do_syncProjectMemory(self);
}

export function do_diffProjectMemory(self: AgentSession): ProjectMemoryDiffResult {
  return do_diffProjectMemory(self);
}

export function do_searchProjectMemory(self: AgentSession, query: string): ProjectMemorySearchResult {
  return do_searchProjectMemory(self, query);
}

export function do_pinProjectMemory(self: AgentSession, text: string): ProjectMemoryPinResult {
  return do_pinProjectMemory(self, text);
}
