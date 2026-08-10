import {
  CachePointType,
  CacheTTL,
  type ContentBlock,
  ConversationRole,
  type Message,
  ToolResultStatus,
} from "@aws-sdk/client-bedrock-runtime";
import type { CacheRetention, Context, Model, ToolResultMessage } from "../../types.ts";
import { sanitizeSurrogates } from "../../utils/sanitize-unicode.ts";
import { transformMessages } from "../transform-messages.ts";
import { EMPTY_TEXT_PLACEHOLDER } from "./constants.ts";
import {
  createImageBlock,
  createNonBlankTextBlock,
  createRequiredTextBlock,
  normalizeToolCallId,
  supportsPromptCaching,
  supportsThinkingSignature,
} from "./message-conversion.ts";
import { convertToolResultContent } from "./response-parsing.ts";

export function convertMessages(
  context: Context,
  model: Model<"bedrock-converse-stream">,
  cacheRetention: CacheRetention,
): Message[] {
  const result: Message[] = [];
  const transformedMessages = transformMessages(context.messages, model, normalizeToolCallId);

  for (let i = 0; i < transformedMessages.length; i++) {
    const m = transformedMessages[i];

    switch (m.role) {
      case "user": {
        const content: ContentBlock[] = [];
        if (typeof m.content === "string") {
          content.push(createRequiredTextBlock(m.content));
        } else {
          for (const c of m.content) {
            switch (c.type) {
              case "text": {
                const textBlock = createNonBlankTextBlock(c.text);
                if (textBlock) content.push(textBlock);
                break;
              }
              case "image":
                content.push({ image: createImageBlock(c.mimeType, c.data) });
                break;
              default:
                continue;
            }
          }
          if (content.length === 0) content.push({ text: EMPTY_TEXT_PLACEHOLDER });
        }
        result.push({
          role: ConversationRole.USER,
          content,
        });
        break;
      }
      case "assistant": {
        // Skip assistant messages with empty content (e.g., from aborted requests)
        // Bedrock rejects messages with empty content arrays
        if (m.content.length === 0) {
          continue;
        }
        const contentBlocks: ContentBlock[] = [];
        for (const c of m.content) {
          switch (c.type) {
            case "text": {
              // Skip empty text blocks
              const textBlock = createNonBlankTextBlock(c.text);
              if (!textBlock) continue;
              contentBlocks.push(textBlock);
              break;
            }
            case "toolCall":
              contentBlocks.push({
                toolUse: { toolUseId: c.id, name: c.name, input: c.arguments },
              });
              break;
            case "thinking": {
              // Skip empty thinking blocks
              const thinking = sanitizeSurrogates(c.thinking);
              if (thinking.trim().length === 0) continue;
              // Only Anthropic models support the signature field in reasoningText.
              // For other models, we omit the signature to avoid errors like:
              // "This model doesn't support the reasoningContent.reasoningText.signature field"
              if (supportsThinkingSignature(model)) {
                // Signatures arrive after thinking deltas. If a partial or externally
                // persisted message lacks a signature, Bedrock rejects the replayed
                // reasoning block. Fall back to plain text, matching Anthropic.
                if (!c.thinkingSignature || c.thinkingSignature.trim().length === 0) {
                  contentBlocks.push({ text: thinking });
                } else {
                  contentBlocks.push({
                    reasoningContent: {
                      reasoningText: {
                        text: thinking,
                        signature: c.thinkingSignature,
                      },
                    },
                  });
                }
              } else {
                contentBlocks.push({
                  reasoningContent: {
                    reasoningText: { text: thinking },
                  },
                });
              }
              break;
            }
            default:
              continue;
          }
        }
        // Skip if all content blocks were filtered out
        if (contentBlocks.length === 0) {
          continue;
        }
        result.push({
          role: ConversationRole.ASSISTANT,
          content: contentBlocks,
        });
        break;
      }
      case "toolResult": {
        // Collect all consecutive toolResult messages into a single user message
        // Bedrock requires all tool results to be in one message
        const toolResults: ContentBlock.ToolResultMember[] = [];

        // Add current tool result with all content blocks combined
        toolResults.push({
          toolResult: {
            toolUseId: m.toolCallId,
            content: convertToolResultContent(m.content),
            status: m.isError ? ToolResultStatus.ERROR : ToolResultStatus.SUCCESS,
          },
        });

        // Look ahead for consecutive toolResult messages
        let j = i + 1;
        while (j < transformedMessages.length && transformedMessages[j].role === "toolResult") {
          const nextMsg = transformedMessages[j] as ToolResultMessage;
          toolResults.push({
            toolResult: {
              toolUseId: nextMsg.toolCallId,
              content: convertToolResultContent(nextMsg.content),
              status: nextMsg.isError ? ToolResultStatus.ERROR : ToolResultStatus.SUCCESS,
            },
          });
          j++;
        }

        // Skip the messages we've already processed
        i = j - 1;

        result.push({
          role: ConversationRole.USER,
          content: toolResults,
        });
        break;
      }
      default:
        continue;
    }
  }

  // Add cache point to the last user message for supported Claude models when caching is enabled
  if (cacheRetention !== "none" && supportsPromptCaching(model) && result.length > 0) {
    const lastMessage = result[result.length - 1];
    if (lastMessage.role === ConversationRole.USER && lastMessage.content) {
      (lastMessage.content as ContentBlock[]).push({
        cachePoint: {
          type: CachePointType.DEFAULT,
          ...(cacheRetention === "long" ? { ttl: CacheTTL.ONE_HOUR } : {}),
        },
      });
    }
  }

  return result;
}
