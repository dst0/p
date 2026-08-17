import type { NormalizedUsageTelemetry, SessionRecordingEvent, TurnEndRecordingEvent } from "./types.ts";

export interface ReconstructedToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  rawArgs?: string;
  result?: unknown;
  isError?: boolean;
  durationMs?: number;
}

export interface ReconstructedMessage {
  role: string;
  content: string;
  reasoning?: string;
  toolCalls: ReconstructedToolCall[];
}

export interface ReplayTurn {
  turnId: string;
  turnIndex: number;
  status: "success" | "interrupted" | "error";
  finishReason?: string;
  message?: ReconstructedMessage;
  usage: NormalizedUsageTelemetry;
  events: SessionRecordingEvent[];
}

export interface SessionReplayResult {
  turns: ReplayTurn[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalReasoningTokens: number;
  totalCachedTokens: number;
  totalCacheWriteTokens: number;
  averageCacheHitRatio: number;
  totalDurationMs: number;
  totalToolCalls: number;
  toolErrors: number;
  finalText: string;
  isInterrupted: boolean;
}

export class SessionStreamReplayer {
  private turns: ReplayTurn[] = [];
  private currentTurnId = "turn_0";
  private currentTurnIndex = 0;
  private currentEvents: SessionRecordingEvent[] = [];
  private currentContent = "";
  private currentReasoning = "";
  private currentToolCalls = new Map<string, ReconstructedToolCall>();
  private partialToolArgs = new Map<string, string>();
  private lastUsage: NormalizedUsageTelemetry | null = null;
  private isInterrupted = false;

  public feedLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const parsed = JSON.parse(trimmed);
      this.feedEvent(parsed);
    } catch {
      // Tolerate malformed lines in stream
    }
  }

  public feedEvent(event: SessionRecordingEvent | Record<string, unknown>): void {
    if (!event || typeof event !== "object") return;

    if ("v" in event && event.v === 1 && "type" in event && typeof event.type === "string") {
      this.handleCanonicalEvent(event as SessionRecordingEvent);
      return;
    }

    this.handleLegacyEvent(event as Record<string, unknown>);
  }

  private handleCanonicalEvent(event: SessionRecordingEvent): void {
    switch (event.type) {
      case "turn_start": {
        if (this.currentEvents.length > 0 && !this.lastUsage) {
          this.commitTurn("interrupted");
        }
        this.currentTurnId = event.payload.turn_id;
        this.currentTurnIndex = event.payload.turn_index;
        this.currentContent = "";
        this.currentReasoning = "";
        this.currentToolCalls.clear();
        this.partialToolArgs.clear();
        this.lastUsage = null;
        this.currentEvents.push(event);
        break;
      }

      case "delta": {
        this.currentEvents.push(event);
        if (event.payload.chan === "content") {
          this.currentContent += event.payload.data;
        } else if (event.payload.chan === "reasoning") {
          this.currentReasoning += event.payload.data;
        }
        break;
      }

      case "tool_chunk": {
        this.currentEvents.push(event);
        const { call_id, name, delta } = event.payload;
        const currentArg = (this.partialToolArgs.get(call_id) ?? "") + delta;
        this.partialToolArgs.set(call_id, currentArg);
        const existing = this.currentToolCalls.get(call_id);
        if (existing) {
          existing.rawArgs = currentArg;
          if (name && !existing.name) existing.name = name;
        } else if (name) {
          this.currentToolCalls.set(call_id, { id: call_id, name, args: {}, rawArgs: currentArg });
        }
        break;
      }

      case "tool_call": {
        this.currentEvents.push(event);
        const { call_id, name, arguments: args, raw_arguments } = event.payload;
        this.currentToolCalls.set(call_id, {
          id: call_id,
          name,
          args,
          rawArgs: raw_arguments ?? JSON.stringify(args),
        });
        break;
      }

      case "tool_result": {
        this.currentEvents.push(event);
        const { call_id, result, is_error, duration_ms } = event.payload;
        const existing = this.currentToolCalls.get(call_id);
        if (existing) {
          existing.result = result;
          existing.isError = is_error;
          existing.durationMs = duration_ms;
        }
        break;
      }

      case "checkpoint": {
        this.currentEvents.push(event);
        break;
      }

      case "turn_end": {
        this.currentEvents.push(event);
        this.lastUsage = event.payload.usage;
        this.commitTurn(event.payload.status, event.payload.finish_reason, event.payload);
        break;
      }
    }
  }

  private handleLegacyEvent(event: Record<string, unknown>): void {
    const type = String(event.type ?? event.event ?? "");
    if (type === "message_update" || type === "message_start") {
      const msg = (event.message ?? (event.assistantMessageEvent as Record<string, unknown>)?.partial) as Record<
        string,
        unknown
      >;
      if (typeof msg?.content === "string") {
        this.currentContent = msg.content;
      }
    } else if (type === "turn_end" || type === "message_end") {
      const usage = (event.usage ?? (event.message as Record<string, unknown>)?.usage) as Record<string, unknown>;
      const input = Number(usage?.input_tokens ?? usage?.prompt_tokens ?? 0);
      const output = Number(usage?.output_tokens ?? usage?.completion_tokens ?? 0);
      const cached = Number(
        usage?.cache_read_input_tokens ?? (usage?.prompt_tokens_details as Record<string, unknown>)?.cached_tokens ?? 0,
      );

      this.lastUsage = {
        input_tokens: input,
        output_tokens: output,
        reasoning_tokens: 0,
        cache: {
          read_tokens: cached,
          write_tokens: 0,
          miss_tokens: input,
          hit_ratio: input + cached > 0 ? cached / (input + cached) : 0,
        },
        cost: { currency: "USD", micros_total: 0, micros_saved_by_cache: 0 },
        timings: { total_duration_ms: 0 },
      };
      this.commitTurn("success");
    }
  }

  private commitTurn(
    status: "success" | "interrupted" | "error",
    finishReason?: string,
    payload?: TurnEndRecordingEvent["payload"],
  ): void {
    const usage = this.lastUsage ??
      payload?.usage ?? {
        input_tokens: 0,
        output_tokens: 0,
        reasoning_tokens: 0,
        cache: { read_tokens: 0, write_tokens: 0, miss_tokens: 0, hit_ratio: 0 },
        cost: { currency: "USD", micros_total: 0, micros_saved_by_cache: 0 },
        timings: { total_duration_ms: 0 },
      };

    if (status === "interrupted") {
      this.isInterrupted = true;
    }

    const message: ReconstructedMessage = {
      role: payload?.message?.role ?? "assistant",
      content: payload?.message?.content ?? this.currentContent,
      reasoning: payload?.message?.reasoning ?? (this.currentReasoning || undefined),
      toolCalls: Array.from(this.currentToolCalls.values()),
    };

    this.turns.push({
      turnId: this.currentTurnId,
      turnIndex: this.currentTurnIndex,
      status,
      finishReason,
      message,
      usage,
      events: [...this.currentEvents],
    });

    this.currentEvents = [];
    this.currentContent = "";
    this.currentReasoning = "";
    this.currentToolCalls.clear();
    this.partialToolArgs.clear();
    this.lastUsage = null;
  }

  public finalize(): SessionReplayResult {
    if (this.currentEvents.length > 0) {
      this.commitTurn("interrupted");
    }

    let totalInput = 0;
    let totalOutput = 0;
    let totalReasoning = 0;
    let totalCached = 0;
    let totalCacheWrite = 0;
    let totalDurationMs = 0;
    let totalToolCalls = 0;
    let toolErrors = 0;
    let lastText = "";

    for (const turn of this.turns) {
      totalInput += turn.usage.input_tokens;
      totalOutput += turn.usage.output_tokens;
      totalReasoning += turn.usage.reasoning_tokens;
      totalCached += turn.usage.cache.read_tokens;
      totalCacheWrite += turn.usage.cache.write_tokens;
      totalDurationMs += turn.usage.timings.total_duration_ms;

      if (turn.message) {
        lastText = turn.message.content;
        totalToolCalls += turn.message.toolCalls.length;
        toolErrors += turn.message.toolCalls.filter((tc) => tc.isError).length;
      }
    }

    const totalCalculatedInput = totalInput + totalCached;
    const avgHitRatio = totalCalculatedInput > 0 ? Number((totalCached / totalCalculatedInput).toFixed(4)) : 0;

    return {
      turns: this.turns,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalReasoningTokens: totalReasoning,
      totalCachedTokens: totalCached,
      totalCacheWriteTokens: totalCacheWrite,
      averageCacheHitRatio: avgHitRatio,
      totalDurationMs,
      totalToolCalls,
      toolErrors,
      finalText: lastText,
      isInterrupted: this.isInterrupted,
    };
  }

  public static replayFromLines(lines: string[]): SessionReplayResult {
    const replayer = new SessionStreamReplayer();
    for (const line of lines) {
      replayer.feedLine(line);
    }
    return replayer.finalize();
  }
}
