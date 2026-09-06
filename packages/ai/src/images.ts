import "./providers/images/register-builtins.ts";

import { getImagesApiProvider } from "./images-api-registry.ts";
import { admitModelCall } from "./model-call-guard.ts";
import type { AssistantImages, ImagesApi, ImagesContext, ImagesModel, ProviderImagesOptions } from "./types.ts";

function resolveImagesApiProvider(api: ImagesApi) {
  const provider = getImagesApiProvider(api);
  if (!provider) {
    throw new Error(`No API provider registered for api: ${api}`);
  }
  return provider;
}

export async function generateImages<TApi extends ImagesApi>(
  model: ImagesModel<TApi>,
  context: ImagesContext,
  options?: ProviderImagesOptions,
): Promise<AssistantImages> {
  const provider = resolveImagesApiProvider(model.api);
  if (options?.signal?.aborted)
    return {
      api: model.api,
      provider: model.provider,
      model: model.id,
      output: [],
      timestamp: Date.now(),
      stopReason: "aborted",
      errorMessage: "Request aborted",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
  const receipt = admitModelCall({ kind: "image", model, signal: options?.signal });
  let settled = false;
  let result: AssistantImages | undefined;
  try {
    result = await provider.generateImages(model, context, options);
    settled = true;
    receipt?.settle(result.usage);
    return result;
  } catch (error) {
    if (!settled) receipt?.settle(undefined);
    if (result)
      return {
        ...result,
        stopReason: "error",
        errorMessage: error instanceof Error ? error.message : "Image receipt persistence failed",
      };
    throw error;
  }
}
