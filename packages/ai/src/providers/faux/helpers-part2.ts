import type { AssistantMessage, Context, StreamOptions } from "../../types.ts";
import { DEFAULT_USAGE } from "./constants.ts";
import { assistantContentToText, commonPrefixLength, estimateTokens, serializeContext } from "./helpers-part1.ts";

export function withUsageEstimate(
  message: AssistantMessage,
  context: Context,
  options: StreamOptions | undefined,
  promptCache: Map<string, string>,
): AssistantMessage {
  const promptText = serializeContext(context);
  const promptTokens = estimateTokens(promptText);
  const outputTokens = estimateTokens(assistantContentToText(message.content));
  let input = promptTokens;
  let cacheRead = 0;
  let cacheWrite = 0;
  const sessionId = options?.sessionId;

  if (sessionId && options?.cacheRetention !== "none") {
    const previousPrompt = promptCache.get(sessionId);
    if (previousPrompt) {
      const cachedChars = commonPrefixLength(previousPrompt, promptText);
      cacheRead = estimateTokens(previousPrompt.slice(0, cachedChars));
      cacheWrite = estimateTokens(promptText.slice(cachedChars));
      input = Math.max(0, promptTokens - cacheRead);
    } else {
      cacheWrite = promptTokens;
    }
    promptCache.set(sessionId, promptText);
  }

  return {
    ...message,
    usage: {
      input,
      output: outputTokens,
      cacheRead,
      cacheWrite,
      totalTokens: input + outputTokens + cacheRead + cacheWrite,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

export function splitStringByTokenSize(text: string, minTokenSize: number, maxTokenSize: number): string[] {
  const chunks: string[] = [];
  let index = 0;
  while (index < text.length) {
    const tokenSize = minTokenSize + Math.floor(Math.random() * (maxTokenSize - minTokenSize + 1));
    const charSize = Math.max(1, tokenSize * 4);
    chunks.push(text.slice(index, index + charSize));
    index += charSize;
  }
  return chunks.length > 0 ? chunks : [""];
}

export function cloneMessage(
  message: AssistantMessage,
  api: string,
  provider: string,
  modelId: string,
): AssistantMessage {
  const cloned = structuredClone(message);
  return {
    ...cloned,
    api,
    provider,
    model: modelId,
    timestamp: cloned.timestamp ?? Date.now(),
    usage: cloned.usage ?? DEFAULT_USAGE,
  };
}

export function createErrorMessage(error: unknown, api: string, provider: string, modelId: string): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api,
    provider,
    model: modelId,
    usage: DEFAULT_USAGE,
    stopReason: "error",
    errorMessage: error instanceof Error ? error.message : String(error),
    timestamp: Date.now(),
  };
}

export function createAbortedMessage(partial: AssistantMessage): AssistantMessage {
  return {
    ...partial,
    stopReason: "aborted",
    errorMessage: "Request was aborted",
    timestamp: Date.now(),
  };
}

export function scheduleChunk(chunk: string, tokensPerSecond: number | undefined): Promise<void> {
  if (!tokensPerSecond || tokensPerSecond <= 0) {
    return new Promise((resolve) => queueMicrotask(resolve));
  }
  const delayMs = (estimateTokens(chunk) / tokensPerSecond) * 1000;
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
