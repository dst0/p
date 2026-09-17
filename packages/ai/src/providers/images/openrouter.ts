import type {
  AssistantImages,
  ImageContent,
  ImagesContext,
  ImagesFunction,
  ImagesModel,
  ImagesOptions,
  TextContent,
} from "../../types.ts";
import { headersToRecord } from "../../utils/headers.ts";
import { decodeImageBase64Safely, detectImageMimeType } from "../../utils/image-mime.ts";
import { sanitizeSurrogates } from "../../utils/sanitize-unicode.ts";
import { withOpenRouterAttributionHeaders } from "../openrouter-headers.ts";
import { getImageJson, postImageJson } from "./image-http.ts";

const MAX_GENERATION_METADATA_RESPONSE_BYTES = 64 * 1024;

interface OpenRouterImagesOptions extends ImagesOptions {
  fetch?: typeof globalThis.fetch;
}

interface OpenRouterImageResponse {
  id?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  };
  choices?: Array<{
    message: {
      content?: string | null;
      images?: Array<{ image_url?: string | { url?: string } }>;
    };
  }>;
}

interface OpenRouterGenerationResponse {
  data?: {
    is_byok?: unknown;
    total_cost?: unknown;
    upstream_inference_cost?: unknown;
  };
}

type OpenRouterContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

interface OpenRouterImagePayload extends Record<string, unknown> {
  model: string;
  messages: Array<{ role: "user"; content: OpenRouterContentPart[] }>;
  stream: false;
  modalities: Array<"image" | "text">;
}

export const generateImagesOpenRouter: ImagesFunction<"openrouter-images", OpenRouterImagesOptions> = async (
  model: ImagesModel<"openrouter-images">,
  context: ImagesContext,
  options?: OpenRouterImagesOptions,
) => {
  const output: AssistantImages = {
    api: model.api,
    provider: model.provider,
    model: model.id,
    output: [],
    stopReason: "stop",
    timestamp: Date.now(),
  };

  try {
    const apiKey = options?.apiKey;
    if (!apiKey) throw new Error(`No API key for provider: ${model.provider}`);
    let payload = buildPayload(model, context);
    const nextPayload = await options?.onPayload?.(payload, model);
    if (nextPayload !== undefined) payload = nextPayload as OpenRouterImagePayload;

    const { data: response, response: rawResponse } = await postImageJson<OpenRouterImageResponse>(
      model.baseUrl,
      "chat/completions",
      payload,
      {
        apiKey,
        headers: withOpenRouterAttributionHeaders(model.baseUrl, model.headers, options?.headers),
        signal: options?.signal,
        timeoutMs: options?.timeoutMs,
        maxRetries: options?.maxRetries,
        maxRetryDelayMs: options?.maxRetryDelayMs,
        fetch: options?.fetch,
      },
    );
    await options?.onResponse?.({ status: rawResponse.status, headers: headersToRecord(rawResponse.headers) }, model);

    output.responseId = response.id;
    if (response.usage) {
      const usage = parseUsage(response.usage, model);
      if (usage) output.usage = usage;
    }
    const choice = response.choices?.[0];
    if (choice?.message.content) {
      output.output.push({ type: "text", text: choice.message.content } satisfies TextContent);
    }
    for (const image of choice?.message.images ?? []) {
      const imageUrl = typeof image.image_url === "string" ? image.image_url : image.image_url?.url;
      const matches = imageUrl?.match(/^data:[^;]+;base64,(.+)$/);
      if (!matches) continue;
      const buffer = decodeImageBase64Safely(matches[1]);
      const mimeType = detectImageMimeType(buffer);
      if (!mimeType) throw new Error("Provider returned image data with unrecognized or invalid binary format");
      output.output.push({ type: "image", mimeType, data: buffer.toString("base64") } satisfies ImageContent);
    }
    if (response.id) {
      const reportedUsd = await fetchReportedUsd(response.id, model, options);
      if (reportedUsd !== undefined) output.reportedUsd = reportedUsd;
    }
    return output;
  } catch (error) {
    output.stopReason = options?.signal?.aborted ? "aborted" : "error";
    output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    return output;
  }
};

function buildPayload(model: ImagesModel<"openrouter-images">, context: ImagesContext): OpenRouterImagePayload {
  const content: OpenRouterContentPart[] = context.input.map((item) =>
    item.type === "text"
      ? { type: "text", text: sanitizeSurrogates(item.text) }
      : { type: "image_url", image_url: { url: `data:${item.mimeType};base64,${item.data}` } },
  );
  return {
    model: model.id,
    messages: [{ role: "user", content }],
    stream: false,
    modalities: model.output.includes("text") ? ["image", "text"] : ["image"],
  };
}

function parseUsage(rawUsage: NonNullable<OpenRouterImageResponse["usage"]>, model: ImagesModel<"openrouter-images">) {
  const promptTokens = rawUsage.prompt_tokens;
  const output = rawUsage.completion_tokens;
  if (!isValidTokenCount(promptTokens) || !isValidTokenCount(output)) return undefined;
  const cacheReadTokens = rawUsage.prompt_tokens_details?.cached_tokens ?? 0;
  const cacheWriteTokens = rawUsage.prompt_tokens_details?.cache_write_tokens ?? 0;
  if (
    !isValidTokenCount(cacheReadTokens) ||
    !isValidTokenCount(cacheWriteTokens) ||
    cacheReadTokens + cacheWriteTokens > promptTokens
  ) {
    return undefined;
  }
  const input = promptTokens - cacheReadTokens - cacheWriteTokens;
  const calculatedTotal = input + output + cacheReadTokens + cacheWriteTokens;
  const totalTokens = rawUsage.total_tokens ?? calculatedTotal;
  if (!isValidTokenCount(totalTokens) || totalTokens !== calculatedTotal) return undefined;
  const usage = {
    input,
    output,
    cacheRead: cacheReadTokens,
    cacheWrite: cacheWriteTokens,
    totalTokens,
    cost: {
      input: (model.cost.input / 1_000_000) * input,
      output: (model.cost.output / 1_000_000) * output,
      cacheRead: (model.cost.cacheRead / 1_000_000) * cacheReadTokens,
      cacheWrite: (model.cost.cacheWrite / 1_000_000) * cacheWriteTokens,
      total: 0,
    },
  };
  const priced = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
  usage.cost.total = priced;
  return usage;
}

function isValidTokenCount(value: number | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

async function fetchReportedUsd(
  responseId: string,
  model: ImagesModel<"openrouter-images">,
  options: OpenRouterImagesOptions | undefined,
): Promise<number | undefined> {
  try {
    const { data: response } = await getImageJson<OpenRouterGenerationResponse>(
      model.baseUrl,
      `generation?id=${encodeURIComponent(responseId)}`,
      {
        apiKey: options?.apiKey,
        headers: withOpenRouterAttributionHeaders(model.baseUrl, model.headers, options?.headers),
        signal: options?.signal,
        timeoutMs: options?.timeoutMs,
        fetch: options?.fetch,
      },
      MAX_GENERATION_METADATA_RESPONSE_BYTES,
    );
    return parseReportedUsd(response);
  } catch {
    return undefined;
  }
}

function parseReportedUsd(response: OpenRouterGenerationResponse): number | undefined {
  if (typeof response.data?.is_byok !== "boolean") return undefined;
  const accountCost = parseCost(response.data.total_cost);
  if (accountCost === undefined) return undefined;
  if (!response.data.is_byok) return accountCost;
  const upstreamCost = parseCost(response.data.upstream_inference_cost);
  if (upstreamCost === undefined) return undefined;
  const total = accountCost + upstreamCost;
  return Number.isFinite(total) ? total : undefined;
}

function parseCost(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
