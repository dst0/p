import OpenAI from "openai";
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
import { detectImageMimeType, validateImageUrlForDownload } from "../../utils/image-mime.ts";
import { sanitizeSurrogates } from "../../utils/sanitize-unicode.ts";

export interface OpenAIImagesOptions extends ImagesOptions {
  size?: "256x256" | "512x512" | "1024x1024" | "1792x1024" | "1024x1792" | string;
  quality?: "standard" | "hd" | string;
  style?: "vivid" | "natural" | string;
}

const MAX_IMAGE_DOWNLOAD_BYTES = 50 * 1024 * 1024; // 50MB

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
    const apiKey = options?.apiKey;
    if (!apiKey) {
      throw new Error(`No API key for provider: ${model.provider}`);
    }

    const client = new OpenAI({
      apiKey,
      baseURL: model.baseUrl,
      dangerouslyAllowBrowser: true,
      defaultHeaders: {
        ...model.headers,
        ...options?.headers,
      },
    });

    const textParts = context.input
      .filter((item): item is TextContent => item.type === "text")
      .map((item) => sanitizeSurrogates(item.text));
    const prompt = textParts.join("\n").trim();

    if (!prompt) {
      throw new Error("No text prompt provided for image generation");
    }

    let params: OpenAI.ImageGenerateParams = {
      model: model.id,
      prompt,
      n: 1,
      response_format: "b64_json",
      ...(options?.size ? { size: options.size as OpenAI.ImageGenerateParams["size"] } : {}),
      ...(options?.quality ? { quality: options.quality as OpenAI.ImageGenerateParams["quality"] } : {}),
      ...(options?.style ? { style: options.style as OpenAI.ImageGenerateParams["style"] } : {}),
    };

    const nextParams = await options?.onPayload?.(params, model);
    if (nextParams !== undefined) {
      params = nextParams as typeof params;
    }

    const requestOptions = {
      ...(options?.signal ? { signal: options.signal } : {}),
      ...(options?.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
      maxRetries: options?.maxRetries ?? 0,
    };

    const { data: response, response: rawResponse } = await client.images
      .generate(params, requestOptions)
      .withResponse();
    await options?.onResponse?.({ status: rawResponse.status, headers: headersToRecord(rawResponse.headers) }, model);

    for (const item of response.data ?? []) {
      if (item.b64_json) {
        const buffer = Buffer.from(item.b64_json, "base64");
        const detectedMime = detectImageMimeType(buffer) || "image/png";
        output.output.push({
          type: "image",
          mimeType: detectedMime,
          data: item.b64_json,
        } satisfies ImageContent);
      } else if (item.url) {
        if (item.url.startsWith("data:")) {
          const matches = item.url.match(/^data:([^;]+);base64,(.+)$/);
          if (matches) {
            const buffer = Buffer.from(matches[2], "base64");
            const detectedMime = detectImageMimeType(buffer) || matches[1];
            output.output.push({
              type: "image",
              mimeType: detectedMime,
              data: matches[2],
            } satisfies ImageContent);
          }
        } else {
          const validation = validateImageUrlForDownload(item.url);
          if (!validation.valid) {
            throw new Error(`Rejected image download URL for security: ${validation.reason} (${item.url})`);
          }

          const fetchRes = await fetch(item.url, { signal: options?.signal });
          if (!fetchRes.ok) {
            throw new Error(`Failed to download image from URL: ${fetchRes.status} ${fetchRes.statusText}`);
          }

          const contentLength = fetchRes.headers.get("content-length");
          if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_DOWNLOAD_BYTES) {
            throw new Error(`Image size exceeds maximum limit of ${MAX_IMAGE_DOWNLOAD_BYTES} bytes`);
          }

          const arrayBuffer = await fetchRes.arrayBuffer();
          if (arrayBuffer.byteLength > MAX_IMAGE_DOWNLOAD_BYTES) {
            throw new Error(`Image download size (${arrayBuffer.byteLength} bytes) exceeds limit`);
          }

          const buffer = Buffer.from(arrayBuffer);
          const detectedMime = detectImageMimeType(buffer) || fetchRes.headers.get("content-type") || "image/png";

          output.output.push({
            type: "image",
            mimeType: detectedMime,
            data: buffer.toString("base64"),
          } satisfies ImageContent);
        }
      }
      if (item.revised_prompt) {
        output.output.push({
          type: "text",
          text: item.revised_prompt,
        } satisfies TextContent);
      }
    }

    return output;
  } catch (error) {
    output.stopReason = options?.signal?.aborted ? "aborted" : "error";
    output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    return output;
  }
};
