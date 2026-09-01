import { type BenchmarkRecordingEvent, createPRecordingAccumulator, parsePRecording } from "../harness/p-recording.ts";
import type { AgentId } from "./runner-options.ts";

type JsonRecord = Record<string, unknown>;

export type TokenUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
};

export type RecordingMetrics = {
  eventCount: number;
  rawEventCount?: number;
  eventTypes: Record<string, number>;
  model?: { provider?: string; id?: string; api?: string };
  responseModel?: string;
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

export function createPRecordingMetricsAccumulator(): RecordingMetricsAccumulator {
  const accumulator = createPRecordingAccumulator(extractText);
  return {
    endTurn: accumulator.endTurn,
    observe(event) {
      accumulator.observe(event as BenchmarkRecordingEvent);
    },
    snapshot() {
      return accumulator.snapshot() as unknown as RecordingMetrics;
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
  for (const event of rawEvents) {
    const part = asRecord(event.part);
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
  let toolErrors = 0;
  for (const event of events) {
    count(eventTypes, event.type);
    const part = asRecord(event.part);
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
      count(stopReasons, part.reason);
      if (part.reason === "error") errors.push("Kilo step failed");
    }
    if (event.type === "text" && typeof part?.text === "string") assistantTexts.push(part.text);
    if (event.type === "error") {
      errors.push(textAt(asRecord(event.error)?.message) || textAt(event.message) || "Kilo error");
    }
  }
  const turns = eventTypes.step_finish ?? 0;
  return {
    eventCount: events.length,
    rawEventCount: rawEvents.length,
    eventTypes,
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

export function parseCodexRecording(rawEvents: readonly JsonRecord[]): RecordingMetrics {
  const events = rawEvents.filter((event) => {
    const type = textAt(event.type);
    return ("type" in event || "message_type" in event) && !type.startsWith("node:") && !type.startsWith("nodejs");
  });
  const eventTypes: Record<string, number> = {};
  const toolNames: Record<string, number> = {};
  const stopReasons: Record<string, number> = {};
  const usage = createUsage();
  const assistantTexts: string[] = [];
  const errors: string[] = [];
  const seenToolIds = new Set<unknown>();
  let toolErrors = 0;
  for (const event of events) {
    const type = event.message_type ?? event.type;
    count(eventTypes, type);
    if (type === "tool_use" && event.tool_name) {
      const id = event.tool_use_id ?? event.id;
      if (id && !seenToolIds.has(id)) {
        seenToolIds.add(id);
        count(toolNames, event.tool_name);
      }
    }
    if (type === "tool_result" && event.status === "error") toolErrors += 1;
    if (type === "assistant" || type === "text") {
      if (typeof event.content === "string") assistantTexts.push(event.content);
      else if (Array.isArray(event.content)) {
        for (const part of event.content.map(asRecord)) {
          if (part?.type === "text" && typeof part.text === "string") assistantTexts.push(part.text);
        }
      }
    }
    if (type === "finish" || type === "turn_end" || type === "step_finish") {
      const tokenUsage = asRecord(event.usage) ?? asRecord(event.token_usage);
      if (tokenUsage) {
        const input = numberAt(tokenUsage.input_tokens ?? tokenUsage.prompt_tokens);
        const output = numberAt(tokenUsage.output_tokens ?? tokenUsage.completion_tokens);
        usage.input += input;
        usage.output += output;
        usage.totalTokens += numberAt(tokenUsage.total_tokens ?? input + output);
      }
      count(stopReasons, event.stop_reason);
    }
    if (type === "error" || event.error) {
      errors.push(textAt(asRecord(event.error)?.message) || textAt(event.message) || "Codex error");
    }
  }
  return {
    eventCount: events.length,
    rawEventCount: rawEvents.length,
    eventTypes,
    usage,
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
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = asRecord(JSON.parse(line) as unknown);
      if (event) events.push(event);
    } catch {
      // Malformed lines remain in the recording but are excluded from metrics.
    }
  }
  if (agent === "kilo") return parseKiloRecording(events);
  if (agent === "codex") return parseCodexRecording(events);
  if (agent === "agy") return parseAgyRecording(events);
  return parsePRecording(events, extractText) as unknown as RecordingMetrics;
}
