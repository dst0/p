import type { AssistantMessage, Model } from "../../types.ts";
import { shortHash } from "../../utils/hash.ts";
import { MAX_MISTRAL_ERROR_BODY_CHARS, MISTRAL_TOOL_CALL_ID_LENGTH } from "./constants.ts";
import type { MistralOptions } from "./types.ts";

export function createOutput(model: Model<"mistral-conversations">): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
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
}

export function deriveMistralToolCallId(id: string, attempt: number): string {
  const normalized = id.replace(/[^a-zA-Z0-9]/g, "");
  if (attempt === 0 && normalized.length === MISTRAL_TOOL_CALL_ID_LENGTH) return normalized;
  const seedBase = normalized || id;
  const seed = attempt === 0 ? seedBase : `${seedBase}:${attempt}`;
  return shortHash(seed)
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, MISTRAL_TOOL_CALL_ID_LENGTH);
}

export function createMistralToolCallIdNormalizer(): (id: string) => string {
  const idMap = new Map<string, string>();
  const reverseMap = new Map<string, string>();

  return (id: string): string => {
    const existing = idMap.get(id);
    if (existing) return existing;

    let attempt = 0;
    while (true) {
      const candidate = deriveMistralToolCallId(id, attempt);
      const owner = reverseMap.get(candidate);
      if (!owner || owner === id) {
        idMap.set(id, candidate);
        reverseMap.set(candidate, id);
        return candidate;
      }
      attempt++;
    }
  };
}

export function truncateErrorText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}... [truncated ${text.length - maxChars} chars]`;
}

export function safeJsonStringify(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return String(value);
  }
}

export function formatMistralError(error: unknown): string {
  if (error instanceof Error) {
    const sdkError = error as Error & { statusCode?: unknown; body?: unknown };
    const statusCode = typeof sdkError.statusCode === "number" ? sdkError.statusCode : undefined;
    const bodyText = typeof sdkError.body === "string" ? sdkError.body.trim() : undefined;
    if (statusCode !== undefined && bodyText) {
      return `Mistral API error (${statusCode}): ${truncateErrorText(bodyText, MAX_MISTRAL_ERROR_BODY_CHARS)}`;
    }
    if (statusCode !== undefined) return `Mistral API error (${statusCode}): ${error.message}`;
    return error.message;
  }
  return safeJsonStringify(error);
}

export function buildRequestOptions(model: Model<"mistral-conversations">, options?: MistralOptions) {
  const requestOptions: {
    signal?: AbortSignal;
    retries: { strategy: "none" };
    headers?: Record<string, string>;
  } = {
    retries: { strategy: "none" },
  };
  if (options?.signal) requestOptions.signal = options.signal;

  const headers: Record<string, string> = {};
  if (model.headers) Object.assign(headers, model.headers);
  if (options?.headers) Object.assign(headers, options.headers);

  // Mistral infrastructure uses `x-affinity` for KV-cache reuse (prefix caching).
  // Respect explicit caller-provided header values.
  if (options?.sessionId && !headers["x-affinity"]) {
    headers["x-affinity"] = options.sessionId;
  }

  if (Object.keys(headers).length > 0) {
    requestOptions.headers = headers;
  }

  return requestOptions;
}

export function buildToolResultText(
  text: string,
  hasImages: boolean,
  supportsImages: boolean,
  isError: boolean,
): string {
  const trimmed = text.trim();
  const errorPrefix = isError ? "[tool error] " : "";

  if (trimmed.length > 0) {
    const imageSuffix = hasImages && !supportsImages ? "\n[tool image omitted: model does not support images]" : "";
    return `${errorPrefix}${trimmed}${imageSuffix}`;
  }

  if (hasImages) {
    if (supportsImages) {
      return isError ? "[tool error] (see attached image)" : "(see attached image)";
    }
    return isError
      ? "[tool error] (image omitted: model does not support images)"
      : "(image omitted: model does not support images)";
  }

  return isError ? "[tool error] (no tool output)" : "(no tool output)";
}
