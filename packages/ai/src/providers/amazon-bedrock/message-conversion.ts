import {
  CachePointType,
  CacheTTL,
  type ContentBlock,
  ImageFormat,
  type SystemContentBlock,
} from "@aws-sdk/client-bedrock-runtime";
import type { CacheRetention, Model, SimpleStreamOptions } from "../../types.ts";
import { sanitizeSurrogates } from "../../utils/sanitize-unicode.ts";
import { EMPTY_TEXT_PLACEHOLDER } from "./constants.ts";

export function getModelMatchCandidates(modelId: string, modelName?: string): string[] {
  const values = modelName ? [modelId, modelName] : [modelId];
  return values.flatMap((value) => {
    const lower = value.toLowerCase();
    return [lower, lower.replace(/[\s_.:]+/g, "-")];
  });
}

export function supportsAdaptiveThinking(modelId: string, modelName?: string): boolean {
  const candidates = getModelMatchCandidates(modelId, modelName);
  return candidates.some(
    (s) =>
      s.includes("opus-4-6") ||
      s.includes("opus-4-7") ||
      s.includes("opus-4-8") ||
      s.includes("sonnet-4-6") ||
      s.includes("fable-5"),
  );
}

export function supportsNativeXhighEffort(model: Model<"bedrock-converse-stream">): boolean {
  const candidates = getModelMatchCandidates(model.id, model.name);
  return candidates.some((s) => s.includes("opus-4-7") || s.includes("opus-4-8") || s.includes("fable-5"));
}

export function mapThinkingLevelToEffort(
  model: Model<"bedrock-converse-stream">,
  level: SimpleStreamOptions["reasoning"],
): "low" | "medium" | "high" | "xhigh" | "max" {
  if (level === "xhigh" && supportsNativeXhighEffort(model)) return "xhigh";

  const mapped = level ? model.thinkingLevelMap?.[level] : undefined;
  if (typeof mapped === "string") return mapped as "low" | "medium" | "high" | "xhigh" | "max";

  switch (level) {
    case "minimal":
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    default:
      return "high";
  }
}

export function resolveCacheRetention(cacheRetention?: CacheRetention): CacheRetention {
  if (cacheRetention) {
    return cacheRetention;
  }
  if (typeof process !== "undefined" && process.env.P_CACHE_RETENTION === "long") {
    return "long";
  }
  return "short";
}

export function isAnthropicClaudeModel(model: Model<"bedrock-converse-stream">): boolean {
  const id = model.id.toLowerCase();
  const name = model.name?.toLowerCase() ?? "";
  return (
    id.includes("anthropic.claude") ||
    id.includes("anthropic/claude") ||
    name.includes("anthropic.claude") ||
    name.includes("anthropic/claude") ||
    name.includes("claude")
  );
}

export function supportsPromptCaching(model: Model<"bedrock-converse-stream">): boolean {
  const candidates = getModelMatchCandidates(model.id, model.name);

  const hasClaudeRef = candidates.some((s) => s.includes("claude"));
  if (!hasClaudeRef) {
    // Application inference profiles don't contain the model name in the ARN.
    // Allow users to force cache points via environment variable.
    if (typeof process !== "undefined" && process.env.AWS_BEDROCK_FORCE_CACHE === "1") return true;
    return false;
  }
  // Claude 4.x models (opus-4, sonnet-4, haiku-4)
  if (candidates.some((s) => s.includes("-4-"))) return true;
  // Claude 3.7 Sonnet
  if (candidates.some((s) => s.includes("claude-3-7-sonnet"))) return true;
  // Claude 3.5 Haiku
  if (candidates.some((s) => s.includes("claude-3-5-haiku"))) return true;
  return false;
}

export function supportsThinkingSignature(model: Model<"bedrock-converse-stream">): boolean {
  return isAnthropicClaudeModel(model);
}

export function buildSystemPrompt(
  systemPrompt: string | undefined,
  model: Model<"bedrock-converse-stream">,
  cacheRetention: CacheRetention,
): SystemContentBlock[] | undefined {
  if (!systemPrompt) return undefined;

  const blocks: SystemContentBlock[] = [{ text: sanitizeSurrogates(systemPrompt) }];

  // Add cache point for supported Claude models when caching is enabled
  if (cacheRetention !== "none" && supportsPromptCaching(model)) {
    blocks.push({
      cachePoint: { type: CachePointType.DEFAULT, ...(cacheRetention === "long" ? { ttl: CacheTTL.ONE_HOUR } : {}) },
    });
  }

  return blocks;
}

export function normalizeToolCallId(id: string): string {
  const sanitized = id.replace(/[^a-zA-Z0-9_-]/g, "_");
  return sanitized.length > 64 ? sanitized.slice(0, 64) : sanitized;
}

export function createNonBlankTextBlock(text: string): ContentBlock.TextMember | undefined {
  const sanitized = sanitizeSurrogates(text);
  return sanitized.trim().length === 0 ? undefined : { text: sanitized };
}

export function createRequiredTextBlock(text: string): ContentBlock.TextMember {
  return createNonBlankTextBlock(text) ?? { text: EMPTY_TEXT_PLACEHOLDER };
}

export function createImageBlock(mimeType: string, data: string) {
  let format: ImageFormat;
  switch (mimeType) {
    case "image/jpeg":
    case "image/jpg":
      format = ImageFormat.JPEG;
      break;
    case "image/png":
      format = ImageFormat.PNG;
      break;
    case "image/gif":
      format = ImageFormat.GIF;
      break;
    case "image/webp":
      format = ImageFormat.WEBP;
      break;
    default:
      throw new Error(`Unknown image type: ${mimeType}`);
  }

  const binaryString = atob(data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return { source: { bytes }, format };
}
