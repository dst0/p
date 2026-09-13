import { type BenchmarkRecordingEvent, createPRecordingAccumulator } from "../harness/p-recording.ts";
import { parseCodexRecording } from "./codex-recording-metrics.ts";
import { readMonetaryCost } from "./monetary-cost.ts";
import type { AgentId } from "./runner-options.ts";

type JsonRecord = Record<string, unknown>;
export type TokenUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost?: unknown;
};
export type RecordingMetrics = {
  eventCount: number;
  rawEventCount?: number;
  eventTypes: Record<string, number>;
  model?: { provider?: string; id?: string; api?: string };
  responseModel?: string;
  responseModels?: string[];
  usage: TokenUsage;
  turns?: number;
  assistantMessages?: number;
  toolCalls: number;
  toolErrors: number;
  toolNames: Record<string, number>;
  stopReasons: Record<string, number>;
  errors: string[];
  finalText: string;
  readRulesBatches?: JsonRecord[];
  phaseRelevantToolCalls?: JsonRecord[];
};
export interface RecordingMetricsAccumulator {
  endTurn(): void;
  observe(event: JsonRecord): void;
  snapshot(): RecordingMetrics;
}
function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null ? (value as JsonRecord) : undefined;
}

function count(counts: Record<string, number>, key: unknown): void {
  if (typeof key === "string") counts[key] = (counts[key] ?? 0) + 1;
}

function numberAt(value: unknown): number {
  return Number(value ?? 0);
}

function textAt(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function createUsage(): TokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map(asRecord)
    .filter((block): block is JsonRecord => block?.type === "text" && typeof block.text === "string")
    .map((block) => String(block.text))
    .join("\n");
}

export function createPRecordingMetricsAccumulator(agent: "p" | "pi" = "p"): RecordingMetricsAccumulator {
  const accumulator = createPRecordingAccumulator(extractText);
  const responseModels = new Set<string>();
  const streamErrors = new Set<string>();
  return {
    endTurn: accumulator.endTurn,
    observe: (event) => {
      const message = asRecord(event.message);
      for (const responseModel of [message?.responseModel, message?.role === "assistant" ? message.model : undefined]) {
        if (typeof responseModel === "string" && responseModel) responseModels.add(responseModel);
      }
      if (event.type === "error") {
        streamErrors.add(textAt(asRecord(event.error)?.message) || textAt(event.message) || "P recording error");
      }
      const usage = asRecord(message?.usage);
      let observedEvent = event;
      if (usage && Object.hasOwn(usage, "cost")) {
        const parsed = readMonetaryCost(usage.cost, agent);
        if (!parsed.ok) {
          streamErrors.add(parsed.error);
          const validUsage = { ...usage };
          delete validUsage.cost;
          observedEvent = { ...event, message: { ...message, usage: validUsage } };
        }
      }
      accumulator.observe(observedEvent as BenchmarkRecordingEvent);
    },
    snapshot: () => {
      const snapshot = accumulator.snapshot() as unknown as RecordingMetrics;
      return {
        ...snapshot,
        responseModels: [...responseModels],
        errors: [...snapshot.errors, ...streamErrors],
      };
    },
  };
}

export function parseAgyRecording(events: readonly JsonRecord[]): RecordingMetrics {
  const usage = createUsage();
  const eventTypes: Record<string, number> = {};
  const toolNames: Record<string, number> = {};
  const seenToolSteps = new Set<unknown>();
  const errors: string[] = [];
  let toolErrors = 0;
  let finalText = "";
  let model: string | undefined;
  let turns = 0;
  for (const event of events) {
    count(eventTypes, event.event ?? "unknown");
    if (event.event === "init") model = textAt(asRecord(event.init)?.model) || undefined;
    if (event.event === "step_update") {
      const step = asRecord(event.step_update);
      if (step?.step_type === "tool" && !seenToolSteps.has(step.step_index)) {
        seenToolSteps.add(step.step_index);
        const toolName = textAt(step.tool_name) || textAt(asRecord(step.tool_info)?.name) || "unknown";
        count(toolNames, toolName);
      }
      if (step?.step_type === "tool" && (step.state === "ERROR" || step.state === "FAILED")) {
        toolErrors += 1;
      }
    }
    if (event.event === "result") {
      const result = asRecord(event.result);
      turns = numberAt(result?.num_turns);
      finalText = textAt(result?.response);
      const resultUsage = asRecord(result?.usage);
      usage.input = numberAt(resultUsage?.input_tokens);
      usage.output = numberAt(resultUsage?.output_tokens);
      usage.cacheRead = numberAt(resultUsage?.cache_read_tokens);
      usage.totalTokens = numberAt(resultUsage?.total_tokens);
      if (result?.status !== "SUCCESS") errors.push(`AGY result status: ${textAt(result?.status) || "unknown"}`);
    }
    if (event.event === "error") {
      errors.push(textAt(asRecord(event.error)?.message) || textAt(event.message) || "AGY error");
    }
  }
  return {
    eventCount: events.length,
    eventTypes,
    model: model ? { provider: "google-antigravity", id: model, api: "agy-cli" } : undefined,
    responseModel: model,
    usage,
    turns,
    assistantMessages: turns,
    toolCalls: seenToolSteps.size,
    toolErrors,
    toolNames,
    stopReasons: {},
    errors,
    finalText,
  };
}

export function parseKiloRecording(rawEvents: readonly JsonRecord[]): RecordingMetrics {
  const events: JsonRecord[] = [];
  const seenEvents = new Set<string>();
  const responseModels = new Set<string>();
  for (const event of rawEvents) {
    const part = asRecord(event.part);
    for (const model of [part?.model, event.model, part?.responseModel, event.responseModel]) {
      if (typeof model === "string" && model.length > 0) responseModels.add(model);
    }
    const key = part?.id
      ? `${String(event.type)}:${String(part.id)}:${String(asRecord(part.state)?.status ?? "")}`
      : JSON.stringify(event);
    if (!seenEvents.has(key)) {
      seenEvents.add(key);
      events.push(event);
    }
  }
  const eventTypes: Record<string, number> = {};
  const toolNames: Record<string, number> = {};
  const usage = createUsage();
  const stopReasons: Record<string, number> = {};
  const assistantTexts: string[] = [];
  const errors: string[] = [];
  const seenToolIds = new Set<unknown>();
  let responseModel: string | undefined;
  let toolErrors = 0;
  let totalCost: number | undefined;
  for (const event of events) {
    count(eventTypes, event.type);
    const part = asRecord(event.part);
    const eventModels = [part?.model, event.model, part?.responseModel, event.responseModel].filter(
      (model): model is string => typeof model === "string" && model.length > 0,
    );
    responseModel = eventModels[0] ?? responseModel;
    if (event.type === "tool_use" && part?.type === "tool" && !seenToolIds.has(part.id)) {
      seenToolIds.add(part.id);
      const toolName = textAt(part.tool) || "unknown";
      count(toolNames, toolName);
      if (asRecord(part.state)?.status === "error") toolErrors += 1;
    }
    if (event.type === "step_finish" && part?.type === "step-finish") {
      const tokens = asRecord(part.tokens);
      usage.input += numberAt(tokens?.input);
      usage.output += numberAt(tokens?.output);
      usage.cacheRead += numberAt(asRecord(tokens?.cache)?.read);
      usage.cacheWrite += numberAt(asRecord(tokens?.cache)?.write);
      usage.totalTokens += numberAt(tokens?.total);
      const rawCost = tokens?.cost ?? part?.cost ?? event.cost;
      if (rawCost !== undefined) {
        const parsedCost = readMonetaryCost(rawCost, "Kilo");
        if (!parsedCost.ok) errors.push(parsedCost.error);
        else totalCost = (totalCost ?? 0) + parsedCost.amount;
      }
      count(stopReasons, part.reason);
      if (part.reason === "error") errors.push("Kilo step failed");
    }
    if (event.type === "text" && typeof part?.text === "string") assistantTexts.push(part.text);
    if (event.type === "error") {
      errors.push(textAt(asRecord(event.error)?.message) || textAt(event.message) || "Kilo error");
    }
  }
  if (totalCost !== undefined) usage.cost = { total: totalCost };
  const turns = eventTypes.step_finish ?? 0;
  return {
    eventCount: events.length,
    rawEventCount: rawEvents.length,
    eventTypes,
    responseModel,
    responseModels: [...responseModels],
    usage,
    turns,
    assistantMessages: turns,
    toolCalls: seenToolIds.size,
    toolErrors,
    toolNames,
    stopReasons,
    errors,
    finalText: assistantTexts.at(-1) ?? "",
  };
}

export function parseRecording(stdout: string, agent: AgentId): RecordingMetrics {
  const events: JsonRecord[] = [];
  let malformedEvents = 0;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = asRecord(JSON.parse(line) as unknown);
      if (event) events.push(event);
    } catch {
      malformedEvents += 1;
    }
  }
  const metrics =
    agent === "kilo"
      ? parseKiloRecording(events)
      : agent === "codex"
        ? parseCodexRecording(events)
        : agent === "agy"
          ? parseAgyRecording(events)
          : (() => {
              const accumulator = createPRecordingMetricsAccumulator(agent);
              for (const event of events) accumulator.observe(event);
              return accumulator.snapshot();
            })();
  if ((agent === "agy" || agent === "codex") && metrics.usage && metrics.usage.cost === undefined) {
    let totalCost: number | undefined;
    for (const event of events) {
      const c = asRecord(asRecord(event.message)?.usage)?.cost ?? event.cost;
      if (c !== undefined) {
        const parsed = readMonetaryCost(c, agent);
        if (parsed.ok) totalCost = (totalCost ?? 0) + parsed.amount;
      }
    }
    if (totalCost !== undefined) metrics.usage.cost = { total: totalCost };
  }
  if (malformedEvents > 0) {
    metrics.errors.push(`Malformed JSONL recording event${malformedEvents === 1 ? "" : "s"}: ${malformedEvents}`);
  }
  return metrics;
}
