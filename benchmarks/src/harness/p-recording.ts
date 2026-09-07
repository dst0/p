import { describeBenchmarkProjectInstructionAction } from "../project-instructions/routing.ts";
import { createTaskVerificationSemanticTracker } from "../project-instructions/verification-semantic-proof.ts";
import { parsePendingRuleBatches } from "./pending-rule-batches.ts";
import { createRecordingRetentionBudget } from "./recording-retention-budget.ts";

const RULE_GATE_BLOCK =
  /Call read_rules with each selected authoritative batch|maximum three project-rule links|already fixed its authoritative project-rule batch|restored authoritative project-rule batch|Project instruction routes changed|Compiled project instructions are unavailable|Unable to verify current project instructions|No project instruction freshness checkpoint|Restart in legacy mode before mutating work/u;
const PENDING_RULE_GATE_BLOCK = /Call read_rules with each selected authoritative batch/u;
const CAP_RULE_GATE_BLOCK = /maximum three project-rule links/u;
const FIXED_RULE_GATE_BLOCK = /already fixed its authoritative project-rule batch/u;
const MAX_RETAINED_EVIDENCE_BYTES = 16 * 1024 * 1024;
const MAX_RETAINED_COLLECTION_ENTRIES = 8_192;
export interface PRecordingAccumulatorOptions {
  maxRetainedCollectionEntries?: number;
  maxRetainedEvidenceBytes?: number;
}
export interface BenchmarkRecordingEvent {
  type?: string;
  model?: { provider?: string; id?: string; api?: string };
  message?: {
    responseModel?: string;
    role?: string;
    model?: string;
    content?: unknown;
    stopReason?: string;
    usage?: Partial<Record<keyof BenchmarkUsage, number>>;
    errorMessage?: string;
  };
  toolName?: string;
  toolCallId?: string;
  toolDescription?: string;
  args?: Record<string, unknown>;
  benchmarkEventOrdinal?: number;
  isError?: boolean;
  executed?: boolean;
  result?: unknown;
  success?: boolean;
  finalError?: string;
}

interface BenchmarkUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
}

interface PhaseRelevantAction {
  toolName: string;
  phases: string[];
  eventOrdinal?: number;
  endOrdinal?: number;
  blockedByProjectRuleGate?: boolean;
  projectRuleGateBlockKind?: "cap" | "pending" | "fixed" | "state";
  pendingRuleBatches?: string[][];
  readonly actionQueries: string[];
}

function resultText(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const content = (result as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => typeof part?.text === "string")
    .map((part) => part.text)
    .join("\n");
}

export function createPRecordingAccumulator(
  extractText: (content: unknown) => string,
  options: PRecordingAccumulatorOptions = {},
) {
  const retention = createRecordingRetentionBudget(
    "P metric evidence",
    options.maxRetainedEvidenceBytes ?? MAX_RETAINED_EVIDENCE_BYTES,
    options.maxRetainedCollectionEntries ?? MAX_RETAINED_COLLECTION_ENTRIES,
  );
  const counts: Record<string, number> = Object.create(null);
  const toolNames: Record<string, number> = Object.create(null);
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
  const stopReasons: Record<string, number> = Object.create(null);
  const pendingReadRules = new Map<string, { links: string[]; startOrdinal?: number }>();
  const readRulesBatches: Array<{ links: string[]; succeeded: boolean; startOrdinal?: number; endOrdinal?: number }> =
    [];
  const phaseRelevantToolCalls: PhaseRelevantAction[] = [];
  const pendingPhaseRelevantCalls = new Map<string, PhaseRelevantAction>();
  const taskVerification = createTaskVerificationSemanticTracker();
  const errors: string[] = [];
  const phaseActionBytes = new WeakMap<PhaseRelevantAction, number>();
  const pendingPhaseBytes = new Map<string, number>();
  const pendingReadBytes = new Map<string, number>();
  let assistantMessageCount = 0;
  let eventCount = 0;
  let finalAssistantTextBytes = 0;
  let finalAssistantText = "";
  let finishSummaryBytes = 0;
  let finishSummary = "";
  let model: BenchmarkRecordingEvent["model"];
  let responseModel: string | undefined;
  let toolErrors = 0;
  const endTurn = (): void => {
    taskVerification.endTurn();
    for (const bytes of pendingPhaseBytes.values()) retention.release(bytes);
    for (const bytes of pendingReadBytes.values()) retention.release(bytes);
    pendingPhaseRelevantCalls.clear();
    pendingReadRules.clear();
    pendingPhaseBytes.clear();
    pendingReadBytes.clear();
  };
  const observe = (event: BenchmarkRecordingEvent): void => {
    eventCount += 1;
    if (event.type === "turn_end") endTurn();
    else {
      taskVerification.start(event as Record<string, unknown>);
      taskVerification.end(event as Record<string, unknown>);
    }
    if (typeof event.type === "string") counts[event.type] = (counts[event.type] ?? 0) + 1;
    if (event.type === "request_start" && event.model) model = event.model;
    if (event.message?.responseModel) responseModel = event.message.responseModel;
    else if (event.message?.role === "assistant" && typeof event.message.model === "string") {
      responseModel = event.message.model;
    }
    if (event.type === "tool_execution_start" && typeof event.toolName === "string") {
      if (!Object.hasOwn(toolNames, event.toolName)) {
        retention.ensureCollectionEntry("P metric tool names", Object.keys(toolNames).length);
        retention.reserve(event.toolName);
      }
      toolNames[event.toolName] = (toolNames[event.toolName] ?? 0) + 1;
      const description = describeBenchmarkProjectInstructionAction(event.toolName, event.args, event.toolDescription);
      if (description) {
        const action: PhaseRelevantAction = {
          toolName: event.toolName,
          phases: description.phases,
          eventOrdinal: event.benchmarkEventOrdinal,
          actionQueries: description.queries,
        };
        Object.defineProperty(action, "actionQueries", {
          enumerable: false,
        });
        retention.ensureCollectionEntry("P metric phase actions", phaseRelevantToolCalls.length);
        phaseActionBytes.set(action, retention.reserve({ ...action, actionQueries: action.actionQueries }));
        phaseRelevantToolCalls.push(action);
        if (typeof event.toolCallId === "string") {
          const previousBytes = pendingPhaseBytes.get(event.toolCallId);
          if (previousBytes === undefined) {
            retention.ensureCollectionEntry("P metric pending phase calls", pendingPhaseRelevantCalls.size);
          } else retention.release(previousBytes);
          pendingPhaseBytes.set(event.toolCallId, retention.reserve(event.toolCallId));
          pendingPhaseRelevantCalls.set(event.toolCallId, action);
        }
      }
      if (event.toolName === "finish_work" && typeof event.args?.summary === "string") {
        finishSummaryBytes = retention.replace(finishSummaryBytes, event.args.summary);
        finishSummary = event.args.summary;
      }
      if (event.toolName === "read_rules" && typeof event.toolCallId === "string") {
        const links = Array.isArray(event.args?.links)
          ? event.args.links.filter((link) => typeof link === "string")
          : [];
        const previousBytes = pendingReadBytes.get(event.toolCallId);
        if (previousBytes === undefined) {
          retention.ensureCollectionEntry("P metric pending rule reads", pendingReadRules.size);
        } else retention.release(previousBytes);
        pendingReadBytes.set(event.toolCallId, retention.reserve({ id: event.toolCallId, links }));
        pendingReadRules.set(event.toolCallId, { links, startOrdinal: event.benchmarkEventOrdinal });
      }
    }
    if (event.type === "tool_execution_end") {
      if (event.isError === true) toolErrors += 1;
      const action = typeof event.toolCallId === "string" ? pendingPhaseRelevantCalls.get(event.toolCallId) : undefined;
      if (action) {
        const text = resultText(event.result);
        action.endOrdinal = event.benchmarkEventOrdinal;
        const blockedByProjectRuleGate =
          event.isError === true && event.executed !== true && RULE_GATE_BLOCK.test(text);
        if (blockedByProjectRuleGate) {
          action.blockedByProjectRuleGate = true;
          action.projectRuleGateBlockKind = CAP_RULE_GATE_BLOCK.test(text)
            ? "cap"
            : PENDING_RULE_GATE_BLOCK.test(text)
              ? "pending"
              : FIXED_RULE_GATE_BLOCK.test(text)
                ? "fixed"
                : "state";
          const pendingBatches = parsePendingRuleBatches(text);
          if (pendingBatches.length > 0) action.pendingRuleBatches = pendingBatches;
        } else if (event.executed !== false) {
          action.blockedByProjectRuleGate = false;
        }
        if (typeof event.toolCallId === "string") pendingPhaseRelevantCalls.delete(event.toolCallId);
        const pendingBytes = typeof event.toolCallId === "string" ? pendingPhaseBytes.get(event.toolCallId) : undefined;
        if (pendingBytes !== undefined && typeof event.toolCallId === "string") {
          retention.release(pendingBytes);
          pendingPhaseBytes.delete(event.toolCallId);
        }
        const previousActionBytes = phaseActionBytes.get(action) ?? 0;
        phaseActionBytes.set(
          action,
          retention.replace(previousActionBytes, { ...action, actionQueries: action.actionQueries }),
        );
      }
      if (event.toolName === "read_rules" && typeof event.toolCallId === "string") {
        const pending = pendingReadRules.get(event.toolCallId) ?? { links: [], startOrdinal: undefined };
        const batch = {
          links: pending.links,
          succeeded: event.isError === false,
          startOrdinal: pending.startOrdinal,
          endOrdinal: event.benchmarkEventOrdinal,
        };
        retention.ensureCollectionEntry("P metric rule batches", readRulesBatches.length);
        retention.reserve(batch);
        readRulesBatches.push(batch);
        pendingReadRules.delete(event.toolCallId);
        const pendingBytes = pendingReadBytes.get(event.toolCallId);
        if (pendingBytes !== undefined) {
          retention.release(pendingBytes);
          pendingReadBytes.delete(event.toolCallId);
        }
      }
    }
    if (event.type === "message_end" && event.message?.role === "assistant") {
      assistantMessageCount += 1;
      const text = extractText(event.message.content);
      finalAssistantTextBytes = retention.replace(finalAssistantTextBytes, text);
      finalAssistantText = text;
      if (event.message.stopReason) {
        if (!Object.hasOwn(stopReasons, event.message.stopReason)) {
          retention.ensureCollectionEntry("P metric stop reasons", Object.keys(stopReasons).length);
          retention.reserve(event.message.stopReason);
        }
        stopReasons[event.message.stopReason] = (stopReasons[event.message.stopReason] ?? 0) + 1;
      }
      for (const key of Object.keys(usage) as Array<keyof BenchmarkUsage>) {
        usage[key] += Number(event.message.usage?.[key] ?? 0);
      }
      if (event.message.stopReason === "error") {
        const error = event.message.errorMessage ?? "assistant error";
        retention.ensureCollectionEntry("P metric errors", errors.length);
        retention.reserve(error);
        errors.push(error);
      }
    }
    if (event.type === "auto_retry_end" && event.success === false) {
      const error = event.finalError ?? "retry failed";
      retention.ensureCollectionEntry("P metric errors", errors.length);
      retention.reserve(error);
      errors.push(error);
    }
  };
  return {
    observe,
    endTurn,
    snapshot() {
      const verificationEvidence = taskVerification.snapshot();
      return {
        eventCount,
        eventTypes: { ...counts },
        model: model ? { provider: model.provider, id: model.id, api: model.api } : undefined,
        responseModel,
        usage: { ...usage },
        turns: counts.turn_end ?? 0,
        assistantMessages: assistantMessageCount,
        toolCalls: counts.tool_execution_start ?? 0,
        toolErrors,
        toolNames: { ...toolNames },
        readRulesBatches,
        phaseRelevantToolCalls,
        stopReasons: { ...stopReasons },
        errors: [...errors],
        acceptedFinishCount: verificationEvidence.acceptedFinishCount,
        acceptedTerminalCompletionCount: verificationEvidence.acceptedTerminalCompletionCount,
        finalText: finalAssistantText || finishSummary,
      };
    },
  };
}

export function parsePRecording(events: readonly BenchmarkRecordingEvent[], extractText: (content: unknown) => string) {
  const accumulator = createPRecordingAccumulator(extractText);
  for (const event of events) accumulator.observe(event);
  return accumulator.snapshot();
}
