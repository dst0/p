import type Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParamsStreaming } from "@anthropic-ai/sdk/resources/messages.js";
import { calculateCost } from "../../models.ts";
import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  SimpleStreamOptions,
  StreamFunction,
  TextContent,
  ThinkingContent,
  Tool,
  ToolCall,
} from "../../types.ts";
import { AssistantMessageEventStream } from "../../utils/event-stream.ts";
import { headersToRecord } from "../../utils/headers.ts";
import { parseStreamingJson } from "../../utils/json-parse.ts";
import { buildCopilotDynamicHeaders, hasCopilotVisionInput } from "../github-copilot-headers.ts";
import { adjustMaxTokensForThinking, buildBaseOptions } from "../simple-options.ts";
import { createClient } from "./content-mapping.ts";
import { iterateAnthropicEvents, mapThinkingLevelToEffort } from "./message-conversion.ts";
import { resolveCacheRetention } from "./request-building.ts";
import { buildParams, shouldUseFineGrainedToolStreamingBeta } from "./response-parsing.ts";
import { mapStopReason } from "./streaming.ts";
import type { AnthropicOptions } from "./types.ts";

export const claudeCodeVersion = "2.1.75";

export const claudeCodeTools = [
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Grep",
  "Glob",
  "AskUserQuestion",
  "EnterPlanMode",
  "ExitPlanMode",
  "KillShell",
  "NotebookEdit",
  "Skill",
  "Task",
  "TaskOutput",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
];

export const ccToolLookup = new Map(claudeCodeTools.map((t) => [t.toLowerCase(), t]));

export const toClaudeCodeName = (name: string) => ccToolLookup.get(name.toLowerCase()) ?? name;

export const fromClaudeCodeName = (name: string, tools?: Tool[]) => {
  if (tools && tools.length > 0) {
    const lowerName = name.toLowerCase();
    const matchedTool = tools.find((tool) => tool.name.toLowerCase() === lowerName);
    if (matchedTool) return matchedTool.name;
  }
  return name;
};

export const FINE_GRAINED_TOOL_STREAMING_BETA = "fine-grained-tool-streaming-2025-05-14";

export const INTERLEAVED_THINKING_BETA = "interleaved-thinking-2025-05-14";

export const ANTHROPIC_MESSAGE_EVENTS: ReadonlySet<string> = new Set([
  "message_start",
  "message_delta",
  "message_stop",
  "content_block_start",
  "content_block_delta",
  "content_block_stop",
]);

export const streamAnthropic: StreamFunction<"anthropic-messages", AnthropicOptions> = (
  model: Model<"anthropic-messages">,
  context: Context,
  options?: AnthropicOptions,
): AssistantMessageEventStream => {
  const stream = new AssistantMessageEventStream();

  (async () => {
    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      api: model.api as Api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    };

    try {
      let client: Anthropic;
      let isOAuth: boolean;

      if (options?.client) {
        client = options.client;
        isOAuth = false;
      } else {
        const apiKey = options?.apiKey;
        if (!apiKey) {
          throw new Error(`No API key for provider: ${model.provider}`);
        }

        let copilotDynamicHeaders: Record<string, string> | undefined;
        if (model.provider === "github-copilot") {
          const hasImages = hasCopilotVisionInput(context.messages);
          copilotDynamicHeaders = buildCopilotDynamicHeaders({
            messages: context.messages,
            hasImages,
          });
        }

        const cacheRetention = options?.cacheRetention ?? resolveCacheRetention();
        const cacheSessionId = cacheRetention === "none" ? undefined : options?.sessionId;

        const created = createClient(
          model,
          apiKey,
          options?.interleavedThinking ?? true,
          shouldUseFineGrainedToolStreamingBeta(model, context),
          options?.headers,
          copilotDynamicHeaders,
          cacheSessionId,
        );
        client = created.client;
        isOAuth = created.isOAuthToken;
      }
      let params = buildParams(model, context, isOAuth, options);
      const nextParams = await options?.onPayload?.(params, model);
      if (nextParams !== undefined) {
        params = nextParams as MessageCreateParamsStreaming;
      }
      const requestOptions = {
        ...(options?.signal ? { signal: options.signal } : {}),
        ...(options?.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
        maxRetries: options?.maxRetries ?? 0,
      };
      const response = await client.messages.create({ ...params, stream: true }, requestOptions).asResponse();
      await options?.onResponse?.({ status: response.status, headers: headersToRecord(response.headers) }, model);
      stream.push({ type: "start", partial: output });

      type Block = (ThinkingContent | TextContent | (ToolCall & { partialJson: string })) & { index: number };
      const blocks = output.content as Block[];

      for await (const event of iterateAnthropicEvents(response, options?.signal)) {
        if (event.type === "message_start") {
          output.responseId = event.message.id;
          // Capture initial token usage from message_start event
          // This ensures we have input token counts even if the stream is aborted early
          output.usage.input = event.message.usage.input_tokens || 0;
          output.usage.output = event.message.usage.output_tokens || 0;
          output.usage.cacheRead = event.message.usage.cache_read_input_tokens || 0;
          output.usage.cacheWrite = event.message.usage.cache_creation_input_tokens || 0;
          output.usage.cacheWrite1h = event.message.usage.cache_creation?.ephemeral_1h_input_tokens || 0;
          // Anthropic doesn't provide total_tokens, compute from components
          output.usage.totalTokens =
            output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
          calculateCost(model, output.usage);
        } else if (event.type === "content_block_start") {
          if (event.content_block.type === "text") {
            const block: Block = {
              type: "text",
              text: "",
              index: event.index,
            };
            output.content.push(block);
            stream.push({ type: "text_start", contentIndex: output.content.length - 1, partial: output });
          } else if (event.content_block.type === "thinking") {
            const block: Block = {
              type: "thinking",
              thinking: "",
              thinkingSignature: "",
              index: event.index,
            };
            output.content.push(block);
            stream.push({ type: "thinking_start", contentIndex: output.content.length - 1, partial: output });
          } else if (event.content_block.type === "redacted_thinking") {
            const block: Block = {
              type: "thinking",
              thinking: "[Reasoning redacted]",
              thinkingSignature: event.content_block.data,
              redacted: true,
              index: event.index,
            };
            output.content.push(block);
            stream.push({ type: "thinking_start", contentIndex: output.content.length - 1, partial: output });
          } else if (event.content_block.type === "tool_use") {
            const block: Block = {
              type: "toolCall",
              id: event.content_block.id,
              name: isOAuth ? fromClaudeCodeName(event.content_block.name, context.tools) : event.content_block.name,
              arguments: (event.content_block.input as Record<string, any>) ?? {},
              partialJson: "",
              index: event.index,
            };
            output.content.push(block);
            stream.push({ type: "toolcall_start", contentIndex: output.content.length - 1, partial: output });
          }
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            const index = blocks.findIndex((b) => b.index === event.index);
            const block = blocks[index];
            if (block && block.type === "text") {
              block.text += event.delta.text;
              stream.push({
                type: "text_delta",
                contentIndex: index,
                delta: event.delta.text,
                partial: output,
              });
            }
          } else if (event.delta.type === "thinking_delta") {
            const index = blocks.findIndex((b) => b.index === event.index);
            const block = blocks[index];
            if (block && block.type === "thinking") {
              block.thinking += event.delta.thinking;
              stream.push({
                type: "thinking_delta",
                contentIndex: index,
                delta: event.delta.thinking,
                partial: output,
              });
            }
          } else if (event.delta.type === "input_json_delta") {
            const index = blocks.findIndex((b) => b.index === event.index);
            const block = blocks[index];
            if (block && block.type === "toolCall") {
              block.partialJson += event.delta.partial_json;
              block.arguments = parseStreamingJson(block.partialJson);
              stream.push({
                type: "toolcall_delta",
                contentIndex: index,
                delta: event.delta.partial_json,
                partial: output,
              });
            }
          } else if (event.delta.type === "signature_delta") {
            const index = blocks.findIndex((b) => b.index === event.index);
            const block = blocks[index];
            if (block && block.type === "thinking") {
              block.thinkingSignature = block.thinkingSignature || "";
              block.thinkingSignature += event.delta.signature;
            }
          }
        } else if (event.type === "content_block_stop") {
          const index = blocks.findIndex((b) => b.index === event.index);
          const block = blocks[index];
          if (block) {
            delete (block as any).index;
            if (block.type === "text") {
              stream.push({
                type: "text_end",
                contentIndex: index,
                content: block.text,
                partial: output,
              });
            } else if (block.type === "thinking") {
              stream.push({
                type: "thinking_end",
                contentIndex: index,
                content: block.thinking,
                partial: output,
              });
            } else if (block.type === "toolCall") {
              block.arguments = parseStreamingJson(block.partialJson);
              // Finalize in-place and strip the scratch buffer so replay only
              // carries parsed arguments.
              delete (block as { partialJson?: string }).partialJson;
              stream.push({
                type: "toolcall_end",
                contentIndex: index,
                toolCall: block,
                partial: output,
              });
            }
          }
        } else if (event.type === "message_delta") {
          if (event.delta.stop_reason) {
            const stopReasonResult = mapStopReason(event.delta.stop_reason, event.delta.stop_details);
            output.stopReason = stopReasonResult.stopReason;
            if (stopReasonResult.errorMessage) {
              output.errorMessage = stopReasonResult.errorMessage;
            }
          }
          // Only update usage fields if present (not null).
          // Preserves input_tokens from message_start when proxies omit it in message_delta.
          if (event.usage.input_tokens != null) {
            output.usage.input = event.usage.input_tokens;
          }
          if (event.usage.output_tokens != null) {
            output.usage.output = event.usage.output_tokens;
          }
          if (event.usage.cache_read_input_tokens != null) {
            output.usage.cacheRead = event.usage.cache_read_input_tokens;
          }
          if (event.usage.cache_creation_input_tokens != null) {
            output.usage.cacheWrite = event.usage.cache_creation_input_tokens;
          }
          // Anthropic doesn't provide total_tokens, compute from components
          output.usage.totalTokens =
            output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
          calculateCost(model, output.usage);
        }
      }

      if (options?.signal?.aborted) {
        throw new Error("Request was aborted");
      }

      if (output.stopReason === "aborted" || output.stopReason === "error") {
        throw new Error(output.errorMessage || "An unknown error occurred");
      }

      stream.push({ type: "done", reason: output.stopReason, message: output });
      stream.end();
    } catch (error) {
      for (const block of output.content) {
        delete (block as { index?: number }).index;
        // partialJson is only a streaming scratch buffer; never persist it.
        delete (block as { partialJson?: string }).partialJson;
      }
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
};

export const streamSimpleAnthropic: StreamFunction<"anthropic-messages", SimpleStreamOptions> = (
  model: Model<"anthropic-messages">,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
  const apiKey = options?.apiKey;
  if (!apiKey) {
    throw new Error(`No API key for provider: ${model.provider}`);
  }

  const base = buildBaseOptions(model, options, apiKey);
  if (!options?.reasoning) {
    return streamAnthropic(model, context, { ...base, thinkingEnabled: false } satisfies AnthropicOptions);
  }

  // For models with adaptive thinking: use an effort level.
  // For older models: use budget-based thinking.
  if (model.compat?.forceAdaptiveThinking === true) {
    const effort = mapThinkingLevelToEffort(model, options.reasoning);
    return streamAnthropic(model, context, {
      ...base,
      thinkingEnabled: true,
      effort,
    } satisfies AnthropicOptions);
  }

  // Undefined means the caller did not request an output cap; let the helper use the model cap.
  // Do not coerce to 0 here, or the thinking budget would become the entire max_tokens value.
  const adjusted = adjustMaxTokensForThinking(
    base.maxTokens,
    model.maxTokens,
    options.reasoning,
    options.thinkingBudgets,
  );

  return streamAnthropic(model, context, {
    ...base,
    maxTokens: adjusted.maxTokens,
    thinkingEnabled: true,
    thinkingBudgetTokens: adjusted.thinkingBudget,
  } satisfies AnthropicOptions);
};
