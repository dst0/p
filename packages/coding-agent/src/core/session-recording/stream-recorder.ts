import type {
  CheckpointRecordingEvent,
  DeltaRecordingEvent,
  NormalizedUsageTelemetry,
  SessionRecordingEvent,
  ToolCallRecordingEvent,
  ToolChunkRecordingEvent,
  ToolResultRecordingEvent,
  TurnEndRecordingEvent,
  TurnStartRecordingEvent,
} from "./types.ts";

export interface SessionStreamRecorderOptions {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  onEvent?: (event: SessionRecordingEvent) => void;
}

export class SessionStreamRecorder {
  private seq = 0;
  private readonly traceId?: string;
  private readonly spanId?: string;
  private readonly parentSpanId?: string;
  private readonly onEvent?: (event: SessionRecordingEvent) => void;

  constructor(options: SessionStreamRecorderOptions = {}) {
    this.traceId = options.traceId;
    this.spanId = options.spanId;
    this.parentSpanId = options.parentSpanId;
    this.onEvent = options.onEvent;
  }

  private nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  private createBaseEvent() {
    const base: { v: 1; seq: number; ts: number; trace_id?: string; span_id?: string; parent_span_id?: string } = {
      v: 1,
      seq: this.nextSeq(),
      ts: Date.now(),
    };
    if (this.traceId) base.trace_id = this.traceId;
    if (this.spanId) base.span_id = this.spanId;
    if (this.parentSpanId) base.parent_span_id = this.parentSpanId;
    return base;
  }

  private emit<T extends SessionRecordingEvent>(event: T): T {
    if (this.onEvent) {
      this.onEvent(event);
    }
    return event;
  }

  public startTurn(options: {
    turnId: string;
    turnIndex: number;
    role?: "user" | "assistant" | "system";
    model?: string;
    provider?: string;
    systemPrefixSha256?: string;
  }): TurnStartRecordingEvent {
    const event: TurnStartRecordingEvent = {
      ...this.createBaseEvent(),
      type: "turn_start",
      payload: {
        turn_id: options.turnId,
        turn_index: options.turnIndex,
        role: options.role ?? "assistant",
        model: options.model,
        provider: options.provider,
        system_prefix_sha256: options.systemPrefixSha256,
      },
    };
    return this.emit(event);
  }

  public recordDelta(streamId: string, chan: "reasoning" | "content", data: string): DeltaRecordingEvent {
    const event: DeltaRecordingEvent = {
      ...this.createBaseEvent(),
      type: "delta",
      payload: {
        stream_id: streamId,
        chan,
        data,
      },
    };
    return this.emit(event);
  }

  public recordToolChunk(
    streamId: string,
    callId: string,
    index: number,
    delta: string,
    name?: string,
  ): ToolChunkRecordingEvent {
    const event: ToolChunkRecordingEvent = {
      ...this.createBaseEvent(),
      type: "tool_chunk",
      payload: {
        stream_id: streamId,
        call_id: callId,
        index,
        name,
        delta,
      },
    };
    return this.emit(event);
  }

  public recordToolCall(
    callId: string,
    name: string,
    args: Record<string, unknown>,
    rawArgs?: string,
  ): ToolCallRecordingEvent {
    const event: ToolCallRecordingEvent = {
      ...this.createBaseEvent(),
      type: "tool_call",
      payload: {
        call_id: callId,
        name,
        arguments: args,
        raw_arguments: rawArgs,
      },
    };
    return this.emit(event);
  }

  public recordToolResult(
    callId: string,
    name: string,
    result: unknown,
    isError: boolean,
    durationMs: number,
  ): ToolResultRecordingEvent {
    const event: ToolResultRecordingEvent = {
      ...this.createBaseEvent(),
      type: "tool_result",
      payload: {
        call_id: callId,
        name,
        result,
        is_error: isError,
        duration_ms: durationMs,
      },
    };
    return this.emit(event);
  }

  public recordCheckpoint(
    streamId: string,
    accumulatedBytes: number,
    accumulatedTokens: number,
    offset: number,
    rollingCrc32?: string,
  ): CheckpointRecordingEvent {
    const event: CheckpointRecordingEvent = {
      ...this.createBaseEvent(),
      type: "checkpoint",
      payload: {
        stream_id: streamId,
        accumulated_bytes: accumulatedBytes,
        accumulated_tokens: accumulatedTokens,
        rolling_crc32: rollingCrc32,
        offset,
      },
    };
    return this.emit(event);
  }

  public endTurn(options: {
    turnId: string;
    turnIndex: number;
    status?: "success" | "interrupted" | "error";
    finishReason?: string;
    message?: {
      role: string;
      content: string;
      reasoning?: string;
      tool_call_ids?: string[];
    };
    rawUsage?: unknown;
    timings?: { ttft_ms?: number; total_duration_ms?: number };
    costMicros?: number;
    costCurrency?: string;
  }): TurnEndRecordingEvent {
    const normalizedUsage = this.normalizeUsage(
      options.rawUsage,
      options.timings,
      options.costMicros,
      options.costCurrency,
    );

    const event: TurnEndRecordingEvent = {
      ...this.createBaseEvent(),
      type: "turn_end",
      payload: {
        turn_id: options.turnId,
        turn_index: options.turnIndex,
        status: options.status ?? "success",
        finish_reason: options.finishReason,
        message: options.message,
        usage: normalizedUsage,
      },
    };
    return this.emit(event);
  }

  public normalizeUsage(
    raw: unknown,
    timings?: { ttft_ms?: number; total_duration_ms?: number },
    costMicros?: number,
    costCurrency?: string,
  ): NormalizedUsageTelemetry {
    const usageObj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

    const inputTokens = Number(usageObj.input_tokens ?? usageObj.prompt_tokens ?? usageObj.prompt_token_count ?? 0);
    const outputTokens = Number(
      usageObj.output_tokens ?? usageObj.completion_tokens ?? usageObj.candidates_token_count ?? 0,
    );
    const reasoningTokens = Number(
      usageObj.reasoning_tokens ??
        (usageObj.completion_tokens_details as Record<string, unknown>)?.reasoning_tokens ??
        0,
    );

    // Normalize cache metrics across providers
    let readTokens = 0;
    let writeTokens = 0;
    let backend: string | undefined;

    if (typeof usageObj.cache_read_input_tokens === "number") {
      readTokens = usageObj.cache_read_input_tokens;
      writeTokens = Number(usageObj.cache_creation_input_tokens ?? 0);
      backend = "anthropic";
    } else if (usageObj.prompt_tokens_details && typeof usageObj.prompt_tokens_details === "object") {
      const details = usageObj.prompt_tokens_details as Record<string, unknown>;
      readTokens = Number(details.cached_tokens ?? 0);
      backend = "openai";
    } else if (typeof usageObj.prompt_cache_hit_tokens === "number") {
      readTokens = usageObj.prompt_cache_hit_tokens;
      backend = "deepseek";
    } else if (typeof usageObj.cached_content_token_count === "number") {
      readTokens = usageObj.cached_content_token_count;
      backend = "gemini";
    }

    let totalInput = inputTokens;
    let missTokens = Math.max(0, inputTokens - readTokens);

    if (backend === "anthropic") {
      // Anthropic reports non-cached input tokens in input_tokens, excluding cache_read_input_tokens
      totalInput = inputTokens + readTokens;
      missTokens = Math.max(0, inputTokens);
    }

    const hitRatio = totalInput > 0 ? Number((readTokens / totalInput).toFixed(4)) : 0;

    return {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      reasoning_tokens: reasoningTokens,
      cache: {
        read_tokens: readTokens,
        write_tokens: writeTokens,
        miss_tokens: missTokens,
        hit_ratio: hitRatio,
        backend,
      },
      cost: {
        currency: costCurrency ?? "USD",
        micros_total: costMicros ?? 0,
        micros_saved_by_cache: Math.round(readTokens * 1.5), // Approximate normalized baseline savings in micros
      },
      timings: {
        ttft_ms: timings?.ttft_ms,
        total_duration_ms: timings?.total_duration_ms ?? 0,
      },
    };
  }
}
