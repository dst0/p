import type { RecordingMetrics } from "./recording-metrics.ts";

type JsonRecord = Record<string, unknown>;

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

export function parseCodexRecording(rawEvents: readonly JsonRecord[]): RecordingMetrics {
  const events = rawEvents.filter((event) => {
    const type = textAt(event.type);
    return ("type" in event || "message_type" in event) && !type.startsWith("node:") && !type.startsWith("nodejs");
  });
  const eventTypes: Record<string, number> = {};
  const toolNames: Record<string, number> = {};
  const stopReasons: Record<string, number> = {};
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
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
