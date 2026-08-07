import type { TSchema } from "typebox";
import type { AssistantMessageDiagnostic } from "../utils/diagnostics.ts";

export * from "./types-part1.ts";

import type { Api, ImagesApi, ImagesProvider, ModelSwitchPhase, Provider } from "./types-part1.ts";
import type { OpenRouterRouting, VercelGatewayRouting } from "./types-part3.ts";

export interface TextContent {
  type: "text";
  text: string;
  textSignature?: string; // e.g., for OpenAI responses, message metadata (legacy id string or TextSignatureV1 JSON)
}

export interface ThinkingContent {
  type: "thinking";
  thinking: string;
  thinkingSignature?: string; // e.g., for OpenAI responses, the reasoning item ID
  /** When true, the thinking content was redacted by safety filters. The opaque
   *  encrypted payload is stored in `thinkingSignature` so it can be passed back
   *  to the API for multi-turn continuity. */
  redacted?: boolean;
}

export interface ImageContent {
  type: "image";
  data: string; // base64 encoded image data
  mimeType: string; // e.g., "image/jpeg", "image/png"
}

export interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, any>;
  thoughtSignature?: string; // Google-specific: opaque signature for reusing thought context
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Subset of `cacheWrite` written with 1h retention. Only Anthropic reports this split. */
  cacheWrite1h?: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

export interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  metadata?: Record<string, unknown>;
  timestamp: number; // Unix timestamp in milliseconds
}

export interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  api: Api;
  provider: Provider;
  model: string;
  responseModel?: string; // Concrete `chunk.model` when different from the requested `model` (e.g. OpenRouter `auto` -> `anthropic/...`)
  responseId?: string; // Provider-specific response/message identifier when the upstream API exposes one
  diagnostics?: AssistantMessageDiagnostic[]; // Redacted provider/runtime diagnostics for failures and recoveries.
  usage: Usage;
  stopReason: StopReason;
  errorMessage?: string;
  timestamp: number; // Unix timestamp in milliseconds
}

export interface ToolResultMessage<TDetails = any> {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[]; // Supports text and images
  details?: TDetails;
  isError: boolean;
  timestamp: number; // Unix timestamp in milliseconds
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;

export type ImagesInputContent = TextContent | ImageContent;

export type ImagesOutputContent = TextContent | ImageContent;

export interface ImagesContext {
  input: ImagesInputContent[];
}

export type ImagesStopReason = "stop" | "error" | "aborted";

export interface AssistantImages {
  api: ImagesApi;
  provider: ImagesProvider;
  model: string;
  output: ImagesOutputContent[];
  responseId?: string;
  usage?: Usage;
  stopReason: ImagesStopReason;
  errorMessage?: string;
  timestamp: number; // Unix timestamp in milliseconds
}

export interface Tool<TParameters extends TSchema = TSchema> {
  name: string;
  description: string;
  parameters: TParameters;
}

export interface Context {
  systemPrompt?: string;
  messages: Message[];
  tools?: Tool[];
}

export type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | {
      type: "prefill_progress";
      elapsedMs: number;
      percent?: number;
      tokens?: number;
      cachedTokens?: number;
      tokensPerSecond?: number;
      cold?: boolean;
      partial: AssistantMessage;
    }
  | {
      type: "cold_prefill_detected";
      elapsedMs: number;
      tokens?: number;
      cachedTokens?: number;
      reason: "provider_signal" | "cache_miss";
      partial: AssistantMessage;
    }
  | { type: "gen_progress"; tokensPerSecond: number; tokens: number; partial: AssistantMessage }
  | {
      type: "queue_progress";
      queue: string;
      position: number;
      queuedAhead: number;
      queuedAtMs?: number;
      queuedForMs?: number;
      ticketId?: string;
      workerId?: string;
      partial: AssistantMessage;
    }
  | {
      type: "model_switch_progress";
      phase: ModelSwitchPhase;
      fromModel: string;
      toModel: string;
      partial: AssistantMessage;
    }
  | { type: "loading_progress"; model: string; partial: AssistantMessage }
  | { type: "done"; reason: Extract<StopReason, "stop" | "length" | "toolUse">; message: AssistantMessage }
  | { type: "error"; reason: Extract<StopReason, "aborted" | "error">; error: AssistantMessage };

export interface OpenAICompletionsCompat {
  /** Whether the provider supports the `store` field. Default: auto-detected from URL. */
  supportsStore?: boolean;
  /** Whether the provider supports the `developer` role (vs `system`). Default: auto-detected from URL. */
  supportsDeveloperRole?: boolean;
  /** Whether the provider supports `reasoning_effort`. Default: auto-detected from URL. */
  supportsReasoningEffort?: boolean;
  /** Whether the provider supports `stream_options: { include_usage: true }` for token usage in streaming responses. Default: true. */
  supportsUsageInStreaming?: boolean;
  /** Which field to use for max tokens. Default: auto-detected from URL. */
  maxTokensField?: "max_completion_tokens" | "max_tokens";
  /** Whether tool results require the `name` field. Default: auto-detected from URL. */
  requiresToolResultName?: boolean;
  /** Whether a user message after tool results requires an assistant message in between. Default: auto-detected from URL. */
  requiresAssistantAfterToolResult?: boolean;
  /** Whether thinking blocks must be converted to text blocks with <thinking> delimiters. Default: auto-detected from URL. */
  requiresThinkingAsText?: boolean;
  /** Whether all replayed assistant messages must include an empty reasoning_content field when reasoning is enabled. Default: auto-detected from URL. */
  requiresReasoningContentOnAssistantMessages?: boolean;
  /** Format for reasoning/thinking parameter. "openai" uses reasoning_effort, "openrouter" uses reasoning: { effort }, "deepseek" uses thinking: { type } plus reasoning_effort when supported, "together" uses reasoning: { enabled } plus reasoning_effort when supported, "zai" uses thinking: { type }, "qwen" uses top-level enable_thinking: boolean, "qwen-chat-template" uses chat_template_kwargs.enable_thinking, "string-thinking" uses top-level thinking: string, and "ant-ling" uses reasoning: { effort } only when the mapped effort is non-null. Default: "openai". */
  thinkingFormat?:
    | "openai"
    | "openrouter"
    | "deepseek"
    | "together"
    | "zai"
    | "qwen"
    | "qwen-chat-template"
    | "string-thinking"
    | "ant-ling";
  /** OpenRouter-compatible routing preferences sent as the `provider` request field. */
  openRouterRouting?: OpenRouterRouting;
  /** Vercel AI Gateway routing preferences. Only used when baseUrl points to Vercel AI Gateway. */
  vercelGatewayRouting?: VercelGatewayRouting;
  /** Whether z.ai supports top-level `tool_stream: true` for streaming tool call deltas. Default: false. */
  zaiToolStream?: boolean;
  /** Whether the provider supports the `strict` field in tool definitions. Default: true. */
  supportsStrictMode?: boolean;
  /** Cache control convention for prompt caching. "anthropic" applies Anthropic-style `cache_control` markers to the system prompt, last tool definition, and last user/assistant text content. */
  cacheControlFormat?: "anthropic";
  /** Whether to send known session-affinity headers (`session_id`, `x-client-request-id`, `x-session-affinity`) from `options.sessionId` when caching is enabled. Default: false. */
  sendSessionAffinityHeaders?: boolean;
  /** Whether the provider supports long prompt cache retention (`prompt_cache_retention: "24h"` or Anthropic-style `cache_control.ttl: "1h"`, depending on format). Default: true. */
  supportsLongCacheRetention?: boolean;
  /** Whether to send llama.cpp-style `cache_prompt: true` when caching is enabled. Default: auto-detected from provider/baseUrl. */
  cachePrompt?: boolean;
}
