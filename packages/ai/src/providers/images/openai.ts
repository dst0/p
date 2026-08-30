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
import { decodeImageBase64Safely, detectImageMimeType, validateImageUrlForDownload } from "../../utils/image-mime.ts";
import { sanitizeSurrogates } from "../../utils/sanitize-unicode.ts";
import { postImageJson } from "./image-http.ts";

export interface OpenAIImagesOptions extends ImagesOptions {
  size?: string;
  quality?: "auto" | "low" | "medium" | "high" | "standard" | "hd" | string;
  style?: "vivid" | "natural" | string;
  fetch?: typeof globalThis.fetch;
  downloadImage?: (url: string, options?: { signal?: AbortSignal }) => Promise<{ buffer: Buffer; mimeType: string }>;
}

interface OpenAIImagePayload extends Record<string, unknown> {
  model: string;
  prompt: string;
  n: number;
  response_format?: "b64_json";
  size?: string;
  quality?: string;
  style?: string;
}

interface OpenAIImageResponse {
  data?: Array<{
    b64_json?: string;
    url?: string;
    revised_prompt?: string;
  }>;
}

export const generateImagesOpenAI: ImagesFunction<"openai-images", OpenAIImagesOptions> = async (
  model: ImagesModel<"openai-images">,
  context: ImagesContext,
  options?: OpenAIImagesOptions,
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
    const requestHeaders = { ...model.headers, ...options?.headers };
    const apiKey = options?.apiKey ?? (model.provider === "llm-orchestrator" ? "local-llm-orchestrator" : undefined);
    if (!apiKey && model.provider === "openai") {
      throw new Error(`No API key for provider: ${model.provider}`);
    }
    if (!apiKey && Object.keys(requestHeaders).length === 0) {
      throw new Error(`No API key or authentication headers for provider: ${model.provider}`);
    }

    const prompt = context.input
      .filter((item): item is TextContent => item.type === "text")
      .map((item) => sanitizeSurrogates(item.text))
      .join("\n")
      .trim();
    if (!prompt) throw new Error("No text prompt provided for image generation");

    let payload: OpenAIImagePayload = {
      model: model.id,
      prompt,
      n: 1,
      ...(model.provider === "openai" ? {} : { response_format: "b64_json" as const }),
      ...(options?.size ? { size: options.size } : {}),
      ...(options?.quality ? { quality: options.quality } : {}),
      ...(options?.style ? { style: options.style } : {}),
    };
    const nextPayload = await options?.onPayload?.(payload, model);
    if (nextPayload !== undefined) payload = nextPayload as OpenAIImagePayload;
    validateOfficialOpenAIOptions(model, payload);

    const { data: response, response: rawResponse } = await postImageJson<OpenAIImageResponse>(
      model.baseUrl,
      "images/generations",
      payload,
      {
        apiKey,
        headers: requestHeaders,
        signal: options?.signal,
        timeoutMs: options?.timeoutMs,
        maxRetries: options?.maxRetries,
        maxRetryDelayMs: options?.maxRetryDelayMs,
        fetch: options?.fetch,
      },
    );
    await options?.onResponse?.({ status: rawResponse.status, headers: headersToRecord(rawResponse.headers) }, model);

    for (const item of response.data ?? []) {
      if (item.b64_json) {
        appendBase64Image(output, item.b64_json, "Provider returned image data");
      } else if (item.url) {
        await appendUrlImage(output, item.url, options);
      }
      if (item.revised_prompt) output.output.push({ type: "text", text: item.revised_prompt } satisfies TextContent);
    }
    return output;
  } catch (error) {
    output.stopReason = options?.signal?.aborted ? "aborted" : "error";
    output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    return output;
  }
};

function validateOfficialOpenAIOptions(model: ImagesModel<"openai-images">, payload: OpenAIImagePayload): void {
  if (model.provider !== "openai" || model.id !== "gpt-image-2") return;
  if (payload.response_format !== undefined) {
    throw new Error("GPT Image 2 does not support response_format");
  }
  if (payload.style !== undefined) {
    throw new Error("GPT Image 2 does not support style");
  }
  if (payload.quality !== undefined && !["auto", "low", "medium", "high"].includes(payload.quality)) {
    throw new Error(`Unsupported GPT Image 2 quality: ${payload.quality}`);
  }
  if (!payload.size || payload.size === "auto") return;
  const match = payload.size.match(/^(\d+)x(\d+)$/);
  if (!match) throw new Error(`Invalid GPT Image 2 size: ${payload.size}`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  const pixels = width * height;
  if (width % 16 !== 0 || height % 16 !== 0) {
    throw new Error("GPT Image 2 dimensions must be multiples of 16 pixels");
  }
  if (Math.max(width, height) > 3840) {
    throw new Error("GPT Image 2 dimensions must not exceed 3840 pixels on either edge");
  }
  if (Math.max(width, height) / Math.min(width, height) > 3) {
    throw new Error("GPT Image 2 dimensions must not exceed a 3:1 aspect ratio");
  }
  if (pixels < 655_360 || pixels > 8_294_400) {
    throw new Error("GPT Image 2 dimensions must contain between 655360 and 8294400 total pixels");
  }
}

function appendBase64Image(output: AssistantImages, data: string, label: string): void {
  const buffer = decodeImageBase64Safely(data);
  const mimeType = detectImageMimeType(buffer);
  if (!mimeType) throw new Error(`${label} with unrecognized or invalid binary format`);
  output.output.push({ type: "image", mimeType, data: buffer.toString("base64") } satisfies ImageContent);
}

async function appendUrlImage(output: AssistantImages, url: string, options?: OpenAIImagesOptions): Promise<void> {
  if (url.startsWith("data:")) {
    const matches = url.match(/^data:[^;]+;base64,(.+)$/);
    if (!matches) throw new Error("Provider returned a malformed image data URL");
    appendBase64Image(output, matches[1], "Data URL image contains data");
    return;
  }

  const urlCheck = validateImageUrlForDownload(url);
  if (!urlCheck.valid) throw new Error(`Rejected image download URL for security: ${urlCheck.reason} (${url})`);
  if (!options?.downloadImage) {
    throw new Error("Remote image URL responses require a trusted download adapter in this runtime");
  }
  const { buffer, mimeType } = await options.downloadImage(url, { signal: options.signal });
  output.output.push({ type: "image", mimeType, data: buffer.toString("base64") } satisfies ImageContent);
}
