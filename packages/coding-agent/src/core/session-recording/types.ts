export type RecordingChannel = "reasoning" | "content" | "tool_arg";

export interface CacheTelemetry {
  read_tokens: number;
  write_tokens: number;
  miss_tokens: number;
  hit_ratio: number;
  backend?: string;
  ttl_seconds?: number;
}

export interface CostTelemetry {
  currency: string;
  micros_total: number;
  micros_saved_by_cache: number;
}

export interface TimingTelemetry {
  ttft_ms?: number;
  total_duration_ms: number;
}

export interface NormalizedUsageTelemetry {
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache: CacheTelemetry;
  cost: CostTelemetry;
  timings: TimingTelemetry;
}

export interface BaseRecordingEvent {
  v: 1;
  seq: number;
  ts: number;
  trace_id?: string;
  span_id?: string;
  parent_span_id?: string;
}

export interface TurnStartRecordingPayload {
  turn_id: string;
  turn_index: number;
  role: "user" | "assistant" | "system";
  model?: string;
  provider?: string;
  system_prefix_sha256?: string;
}

export interface TurnStartRecordingEvent extends BaseRecordingEvent {
  type: "turn_start";
  payload: TurnStartRecordingPayload;
}

export interface DeltaRecordingPayload {
  stream_id: string;
  chan: "reasoning" | "content";
  data: string;
}

export interface DeltaRecordingEvent extends BaseRecordingEvent {
  type: "delta";
  payload: DeltaRecordingPayload;
}

export interface ToolChunkRecordingPayload {
  stream_id: string;
  call_id: string;
  index: number;
  name?: string;
  delta: string;
}

export interface ToolChunkRecordingEvent extends BaseRecordingEvent {
  type: "tool_chunk";
  payload: ToolChunkRecordingPayload;
}

export interface ToolCallRecordingPayload {
  call_id: string;
  name: string;
  arguments: Record<string, unknown>;
  raw_arguments?: string;
}

export interface ToolCallRecordingEvent extends BaseRecordingEvent {
  type: "tool_call";
  payload: ToolCallRecordingPayload;
}

export interface ToolResultRecordingPayload {
  call_id: string;
  name: string;
  result: unknown;
  is_error: boolean;
  duration_ms: number;
}

export interface ToolResultRecordingEvent extends BaseRecordingEvent {
  type: "tool_result";
  payload: ToolResultRecordingPayload;
}

export interface TurnEndRecordingPayload {
  turn_id: string;
  turn_index: number;
  status: "success" | "interrupted" | "error";
  finish_reason?: string;
  message?: {
    role: string;
    content: string;
    reasoning?: string;
    tool_call_ids?: string[];
  };
  usage: NormalizedUsageTelemetry;
}

export interface TurnEndRecordingEvent extends BaseRecordingEvent {
  type: "turn_end";
  payload: TurnEndRecordingPayload;
}

export interface CheckpointRecordingPayload {
  stream_id: string;
  accumulated_bytes: number;
  accumulated_tokens: number;
  rolling_crc32?: string;
  offset: number;
}

export interface CheckpointRecordingEvent extends BaseRecordingEvent {
  type: "checkpoint";
  payload: CheckpointRecordingPayload;
}

export type SessionRecordingEvent =
  | TurnStartRecordingEvent
  | DeltaRecordingEvent
  | ToolChunkRecordingEvent
  | ToolCallRecordingEvent
  | ToolResultRecordingEvent
  | TurnEndRecordingEvent
  | CheckpointRecordingEvent;
