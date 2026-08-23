import { describeBenchmarkProjectInstructionAction } from "./benchmark-project-instruction-routing.js";

const RULE_GATE_BLOCK = /Call read_rules with each selected authoritative batch|maximum three project-rule links|already fixed its authoritative project-rule batch|restored authoritative project-rule batch|Project instruction routes changed|Compiled project instructions are unavailable|Unable to verify current project instructions|No project instruction freshness checkpoint|Restart in legacy mode before mutating work/u;
const PENDING_RULE_GATE_BLOCK = /Call read_rules with each selected authoritative batch/u;
const CAP_RULE_GATE_BLOCK = /maximum three project-rule links/u;
const FIXED_RULE_GATE_BLOCK = /already fixed its authoritative project-rule batch/u;
function resultText(result) {
  const content = result?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((part) => typeof part?.text === "string").map((part) => part.text).join("\n");
}

export function parsePRecording(events, extractText) {
  const counts = {};
  const toolNames = {};
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
  const stopReasons = {};
  const assistantTexts = [];
  const finishSummaries = [];
  const pendingReadRules = new Map();
  const readRulesBatches = [];
  const phaseRelevantToolCalls = [];
  const pendingPhaseRelevantCalls = new Map();
  const errors = [];
  let assistantMessageCount = 0;
  let model;
  let responseModel;
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
        const action = {
          toolName: event.toolName,
          phases: description.phases,
          eventOrdinal: event.benchmarkEventOrdinal,
        };
        Object.defineProperty(action, "actionQueries", {
          value: description.queries,
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
      const action = pendingPhaseRelevantCalls.get(event.toolCallId);
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
        pendingPhaseRelevantCalls.delete(event.toolCallId);
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
      for (const key of Object.keys(usage)) usage[key] += Number(event.message.usage?.[key] ?? 0);
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

function parsePendingRuleBatches(text) {
  if (!PENDING_RULE_GATE_BLOCK.test(text)) return [];
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((batch) => {
      const links = Array.isArray(batch?.links)
        ? batch.links.filter((link) => typeof link === "string" && /^rules\/[a-z0-9./-]+$/u.test(link))
        : [];
      return links.length > 0 && links.length <= 3 && links.length === batch.links.length ? [links] : [];
    });
  } catch {
    return [];
  }
}
