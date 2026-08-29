import { describeBenchmarkProjectInstructionAction } from "../project-instructions/routing.ts";

const RULE_GATE_BLOCK =
  /Call read_rules with each selected authoritative batch|maximum three project-rule links|already fixed its authoritative project-rule batch|restored authoritative project-rule batch|Project instruction routes changed|Compiled project instructions are unavailable|Unable to verify current project instructions|No project instruction freshness checkpoint|Restart in legacy mode before mutating work/u;
const PENDING_RULE_GATE_BLOCK = /Call read_rules with each selected authoritative batch/u;
const CAP_RULE_GATE_BLOCK = /maximum three project-rule links/u;
const FIXED_RULE_GATE_BLOCK = /already fixed its authoritative project-rule batch/u;
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

export function parsePRecording(events: readonly BenchmarkRecordingEvent[], extractText: (content: unknown) => string) {
  const counts: Record<string, number> = {};
  const toolNames: Record<string, number> = {};
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
  const stopReasons: Record<string, number> = {};
  const assistantTexts: string[] = [];
  const finishSummaries: string[] = [];
  const pendingReadRules = new Map<string, { links: string[]; startOrdinal?: number }>();
  const readRulesBatches: Array<{ links: string[]; succeeded: boolean; startOrdinal?: number; endOrdinal?: number }> =
    [];
  const phaseRelevantToolCalls: PhaseRelevantAction[] = [];
  const pendingPhaseRelevantCalls = new Map<string, PhaseRelevantAction>();
  const errors: string[] = [];
  let assistantMessageCount = 0;
  let model: BenchmarkRecordingEvent["model"];
  let responseModel: string | undefined;
  let toolErrors = 0;
  for (const event of events) {
    if (typeof event.type === "string") counts[event.type] = (counts[event.type] ?? 0) + 1;
    if (event.type === "request_start" && event.model) model = event.model;
    if (event.message?.responseModel) responseModel = event.message.responseModel;
    else if (event.message?.role === "assistant" && typeof event.message.model === "string") {
      responseModel = event.message.model;
    }
    if (event.type === "tool_execution_start" && typeof event.toolName === "string") {
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
        phaseRelevantToolCalls.push(action);
        if (typeof event.toolCallId === "string") pendingPhaseRelevantCalls.set(event.toolCallId, action);
      }
      if (event.toolName === "finish_work" && typeof event.args?.summary === "string") {
        finishSummaries.push(event.args.summary);
      }
      if (event.toolName === "read_rules" && typeof event.toolCallId === "string") {
        const links = Array.isArray(event.args?.links)
          ? event.args.links.filter((link) => typeof link === "string")
          : [];
        pendingReadRules.set(event.toolCallId, { links, startOrdinal: event.benchmarkEventOrdinal });
      }
    }
    if (event.type === "tool_execution_end") {
      if (event.isError === true) toolErrors += 1;
      const action = typeof event.toolCallId === "string" ? pendingPhaseRelevantCalls.get(event.toolCallId) : undefined;
      if (action) {
        const text = resultText(event.result);
        action.endOrdinal = event.benchmarkEventOrdinal;
        action.blockedByProjectRuleGate = event.isError === true && RULE_GATE_BLOCK.test(text);
        if (action.blockedByProjectRuleGate) {
          action.projectRuleGateBlockKind = CAP_RULE_GATE_BLOCK.test(text)
            ? "cap"
            : PENDING_RULE_GATE_BLOCK.test(text)
              ? "pending"
              : FIXED_RULE_GATE_BLOCK.test(text)
                ? "fixed"
                : "state";
          const pendingBatches = parsePendingRuleBatches(text);
          if (pendingBatches.length > 0) action.pendingRuleBatches = pendingBatches;
        }
        if (typeof event.toolCallId === "string") pendingPhaseRelevantCalls.delete(event.toolCallId);
      }
      if (event.toolName === "read_rules" && typeof event.toolCallId === "string") {
        const pending = pendingReadRules.get(event.toolCallId) ?? { links: [], startOrdinal: undefined };
        readRulesBatches.push({
          links: pending.links,
          succeeded: event.isError === false,
          startOrdinal: pending.startOrdinal,
          endOrdinal: event.benchmarkEventOrdinal,
        });
        pendingReadRules.delete(event.toolCallId);
      }
    }
    if (event.type === "message_end" && event.message?.role === "assistant") {
      assistantMessageCount += 1;
      assistantTexts.push(extractText(event.message.content));
      if (event.message.stopReason) {
        stopReasons[event.message.stopReason] = (stopReasons[event.message.stopReason] ?? 0) + 1;
      }
      for (const key of Object.keys(usage) as Array<keyof BenchmarkUsage>) {
        usage[key] += Number(event.message.usage?.[key] ?? 0);
      }
      if (event.message.stopReason === "error") errors.push(event.message.errorMessage ?? "assistant error");
    }
    if (event.type === "auto_retry_end" && event.success === false) {
      errors.push(event.finalError ?? "retry failed");
    }
  }
  return {
    eventCount: events.length,
    eventTypes: counts,
    model: model ? { provider: model.provider, id: model.id, api: model.api } : undefined,
    responseModel,
    usage,
    turns: counts.turn_end ?? 0,
    assistantMessages: assistantMessageCount,
    toolCalls: counts.tool_execution_start ?? 0,
    toolErrors,
    toolNames,
    readRulesBatches,
    phaseRelevantToolCalls,
    stopReasons,
    errors,
    finalText: assistantTexts.at(-1) || finishSummaries.at(-1) || "",
  };
}

function parsePendingRuleBatches(text: string): string[][] {
  if (!PENDING_RULE_GATE_BLOCK.test(text)) return [];
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value) => {
      const batch = value && typeof value === "object" ? (value as { links?: unknown }) : undefined;
      const batchLinks = batch?.links;
      if (!Array.isArray(batchLinks)) return [];
      const links = batchLinks.filter(
        (link): link is string => typeof link === "string" && /^rules\/[a-z0-9./-]+$/u.test(link),
      );
      return links.length > 0 && links.length <= 3 && links.length === batchLinks.length ? [links] : [];
    });
  } catch {
    return [];
  }
}
