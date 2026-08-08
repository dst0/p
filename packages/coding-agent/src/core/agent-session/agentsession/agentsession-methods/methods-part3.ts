import type { AgentMessage } from "@dst0/p-agent-core";
import type { AssistantMessage } from "@dst0/p-ai";
import type {
  CompactionDetails,
  CompactionPreparation,
  CompactionResult,
  CompactionSettings,
  StatePatch,
  StructuredSessionState,
} from "../../../compaction/index.ts";
import type { ExtensionRunner, ToolDefinition } from "../../../extensions/index.ts";
import type { ConstraintPhase, GuardrailReport } from "../../../guardrails.ts";
import type { ProjectMemoryForgetResult } from "../../../project-memory.ts";
import type { RuleExplainResult, RuleLintResult } from "../../../project-rules.ts";
import type { RepoMap } from "../../../repo-map.ts";
import type { SessionEntry } from "../../../session-manager.ts";
import type { RunSubagentInput, RunSubagentResult, SubagentDigest, SubagentName } from "../../../subagents.ts";
import type {
  KEEP_CONTEXT_SCHEMA,
  MARK_SESSION_PROGRESS_SCHEMA,
  RUN_SUBAGENT_SCHEMA,
  SESSION_RECALL_SCHEMA,
  TOOL_SEARCH_SCHEMA,
  UPDATE_SESSION_STATE_SCHEMA,
} from "../../constants.ts";
import type {
  CompactionDryRunResult,
  ExtensionBindings,
  SessionRecallInput,
  ToolSearchResult,
  UpdateSessionStateInput,
} from "../../types-part1.ts";
import type {
  MarkSessionProgressInput,
  MarkSessionProgressResult,
  RecallCandidate,
  RecallResult,
  UpdateSessionStateResult,
} from "../../types-part2.ts";
import type { AgentSession } from "../agentsession.ts";

export function do_forgetProjectMemory(self: AgentSession, id: string): ProjectMemoryForgetResult {
  return do_forgetProjectMemory(self, id);
}

export function do_lintProjectRules(self: AgentSession): RuleLintResult {
  return do_lintProjectRules(self);
}

export function do_explainProjectRules(self: AgentSession, query: string): RuleExplainResult {
  return do_explainProjectRules(self, query);
}

export function do_updateRepoMap(self: AgentSession): RepoMap {
  return do_updateRepoMap(self);
}

export function do_recordSubagentDigest(
  self: AgentSession,
  profile: SubagentName,
  query: string,
  summary: string,
  evidencePointers: string[] = [],
): SubagentDigest {
  return do_recordSubagentDigest(self, profile, query, summary, evidencePointers);
}

export function do_evaluateGuardrails(self: AgentSession, phase: ConstraintPhase = "final"): GuardrailReport {
  return do_evaluateGuardrails(self, phase);
}

export function do_getCompactionDryRun(self: AgentSession): CompactionDryRunResult {
  return do_getCompactionDryRun(self);
}

export function do__createUpdateSessionStateToolDefinition(
  self: AgentSession,
): ToolDefinition<typeof UPDATE_SESSION_STATE_SCHEMA, UpdateSessionStateResult> {
  return do__createUpdateSessionStateToolDefinition(self);
}

export function do__applyUpdateSessionState(
  self: AgentSession,
  input: UpdateSessionStateInput,
): UpdateSessionStateResult {
  return do__applyUpdateSessionState(self, input);
}

export function do__autoExecuteUpdateSessionState(self: AgentSession): void {
  do__autoExecuteUpdateSessionState(self);
}

export function do__reconcileSuccessfulFinishWorkState(self: AgentSession): void {
  do__reconcileSuccessfulFinishWorkState(self);
}

export function do__createStatePatchFromUpdateSessionStateInput(
  self: AgentSession,
  input: UpdateSessionStateInput,
  previous: StructuredSessionState,
  sourceEntryIds: string[],
  liveState: StructuredSessionState,
): StatePatch | undefined {
  return do__createStatePatchFromUpdateSessionStateInput(self, input, previous, sourceEntryIds, liveState);
}

export function do__createMarkSessionProgressToolDefinition(
  self: AgentSession,
): ToolDefinition<typeof MARK_SESSION_PROGRESS_SCHEMA, MarkSessionProgressResult> {
  return do__createMarkSessionProgressToolDefinition(self);
}

export function do__applyMarkSessionProgress(
  self: AgentSession,
  input: MarkSessionProgressInput,
): MarkSessionProgressResult {
  return do__applyMarkSessionProgress(self, input);
}

export function do__createSessionRecallToolDefinition(
  self: AgentSession,
): ToolDefinition<typeof SESSION_RECALL_SCHEMA, RecallResult> {
  return do__createSessionRecallToolDefinition(self);
}

export function do__createToolSearchToolDefinition(
  self: AgentSession,
): ToolDefinition<typeof TOOL_SEARCH_SCHEMA, ToolSearchResult> {
  return do__createToolSearchToolDefinition(self);
}

export function do__createKeepContextToolDefinition(
  self: AgentSession,
): ToolDefinition<typeof KEEP_CONTEXT_SCHEMA, any> {
  return do__createKeepContextToolDefinition(self);
}

export function do__createRunSubagentToolDefinition(
  self: AgentSession,
): ToolDefinition<typeof RUN_SUBAGENT_SCHEMA, RunSubagentResult> {
  return do__createRunSubagentToolDefinition(self);
}

export async function do__runSubagent(self: AgentSession, input: RunSubagentInput): Promise<RunSubagentResult> {
  return do__runSubagent(self, input);
}

export function do__formatSubagentResult(self: AgentSession, result: RunSubagentResult): string {
  return do__formatSubagentResult(self, result);
}

export function do__recallSessionEvidence(self: AgentSession, params: SessionRecallInput): RecallResult {
  return do__recallSessionEvidence(self, params);
}

export function do__collectRecallCandidates(self: AgentSession): RecallCandidate[] {
  return do__collectRecallCandidates(self);
}

export function do__prepareDeterministicCompaction(
  self: AgentSession,
  preparation: CompactionPreparation,
  pathEntries: SessionEntry[],
  settings: CompactionSettings & { renderedStateMaxTokens: number },
): CompactionResult<CompactionDetails> & { state: StructuredSessionState } {
  return do__prepareDeterministicCompaction(self, preparation, pathEntries, settings);
}

export async function do__prepareDefaultCompaction(
  self: AgentSession,
  preparation: CompactionPreparation,
  pathEntries: SessionEntry[],
  settings: CompactionSettings & { renderedStateMaxTokens: number },
  customInstructions: string | undefined,
  signal: AbortSignal | undefined,
): Promise<CompactionResult<CompactionDetails> & { state: StructuredSessionState }> {
  return do__prepareDefaultCompaction(self, preparation, pathEntries, settings, customInstructions, signal);
}

export async function do_compact(self: AgentSession, customInstructions?: string): Promise<CompactionResult> {
  return do_compact(self, customInstructions);
}

export function do_abortCompaction(self: AgentSession): void {
  do_abortCompaction(self);
}

export function do_abortBranchSummary(self: AgentSession): void {
  do_abortBranchSummary(self);
}

export async function do_checkCompaction(
  self: AgentSession,
  assistantMessage: AssistantMessage | undefined,
  skipAbortedCheck = true,
  additionalMessages?: AgentMessage[],
): Promise<boolean> {
  return do_checkCompaction(self, assistantMessage, skipAbortedCheck, additionalMessages);
}

export async function do__runAutoCompaction(
  self: AgentSession,
  reason: "overflow" | "threshold",
  willRetry: boolean,
): Promise<boolean> {
  return do__runAutoCompaction(self, reason, willRetry);
}

export function do_setAutoCompactionEnabled(self: AgentSession, enabled: boolean): void {
  do_setAutoCompactionEnabled(self, enabled);
}

export function do__getEffectiveCompactionSettings(self: AgentSession): {
  enabled: boolean;
  triggerReserveTokens: number;
  triggerRatio?: number;
  keepRecentMinTokens: number;
  keepRecentMaxTokens: number;
  summaryMaxTokens: number;
  renderedStateMaxTokens: number;
  targetContextTokens: number;
} {
  return do__getEffectiveCompactionSettings(self);
}

export async function do_bindExtensions(self: AgentSession, bindings: ExtensionBindings): Promise<void> {
  return do_bindExtensions(self, bindings);
}

export async function do_extendResourcesFromExtensions(
  self: AgentSession,
  reason: "startup" | "reload",
): Promise<void> {
  return do_extendResourcesFromExtensions(self, reason);
}

export function do_buildExtensionResourcePaths(
  self: AgentSession,
  entries: Array<{ path: string; extensionPath: string }>,
): Array<{
  path: string;
  metadata: {
    source: string;
    scope: "temporary";
    origin: "top-level";
    baseDir?: string;
  };
}> {
  return do_buildExtensionResourcePaths(self, entries);
}

export function do_getExtensionSourceLabel(self: AgentSession, extensionPath: string): string {
  return do_getExtensionSourceLabel(self, extensionPath);
}

export function do__applyExtensionBindings(self: AgentSession, runner: ExtensionRunner): void {
  do__applyExtensionBindings(self, runner);
}

export function do__refreshCurrentModelFromRegistry(self: AgentSession): void {
  do__refreshCurrentModelFromRegistry(self);
}

export function do__bindExtensionCore(self: AgentSession, runner: ExtensionRunner): void {
  do__bindExtensionCore(self, runner);
}

export function do__refreshToolRegistry(
  self: AgentSession,
  options?: { activeToolNames?: string[]; includeAllExtensionTools?: boolean },
): void {
  do__refreshToolRegistry(self, options);
}

export function do__buildRuntime(
  self: AgentSession,
  options: {
    activeToolNames?: string[];
    flagValues?: Map<string, boolean | string>;
    includeAllExtensionTools?: boolean;
  },
): void {
  do__buildRuntime(self, options);
}

export async function do_reload(self: AgentSession): Promise<void> {
  return do_reload(self);
}
