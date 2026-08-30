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
import { downloadImageSafely } from "../../utils/image-download.ts";
import { detectImageMimeType } from "../../utils/image-mime.ts";
import { sanitizeSurrogates } from "../../utils/sanitize-unicode.ts";

export interface OpenAIImagesOptions extends ImagesOptions {
  size?: "256x256" | "512x512" | "1024x1024" | "1792x1024" | "1024x1792" | string;
  quality?: "standard" | "hd" | string;
  style?: "vivid" | "natural" | string;
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
        const detectedMime = detectImageMimeType(buffer);
        if (!detectedMime) {
          throw new Error("Provider returned image data with unrecognized or invalid binary format");
        }
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
            const detectedMime = detectImageMimeType(buffer);
            if (!detectedMime) {
              throw new Error("Data URL image contains unrecognized or invalid binary format");
            }
            output.output.push({
              type: "image",
              mimeType: detectedMime,
              data: matches[2],
            } satisfies ImageContent);
          }
        } else {
          const { buffer, mimeType } = await downloadImageSafely(item.url, { signal: options?.signal });
          output.output.push({
            type: "image",
            mimeType,
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
