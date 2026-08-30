import { IMAGE_MODELS } from "./image-models.generated.ts";
import type { ImagesApi, ImagesModel, KnownImagesProvider } from "./types.ts";

const DEFAULT_LLM_ORCHESTRATOR_BASE_URL = "http://127.0.0.1:11450/v1";

const imageModelRegistry: Map<string, Map<string, ImagesModel<ImagesApi>>> = new Map();

for (const [provider, models] of Object.entries(IMAGE_MODELS)) {
  const providerModels = new Map<string, ImagesModel<ImagesApi>>();
  for (const [id, model] of Object.entries(models)) {
    providerModels.set(id, model as ImagesModel<ImagesApi>);
  }
  imageModelRegistry.set(provider, providerModels);
}

type GeneratedImageModels = typeof IMAGE_MODELS;

type ImageModelApi<TProvider extends string, TModelId extends string> = TProvider extends keyof GeneratedImageModels
  ? TModelId extends keyof GeneratedImageModels[TProvider]
    ? GeneratedImageModels[TProvider][TModelId] extends { api: infer TApi }
      ? TApi extends ImagesApi
        ? TApi
        : ImagesApi
      : ImagesApi
    : ImagesApi
  : ImagesApi;

export interface ImageModelLookupOptions {
  baseUrl?: string;
  headers?: Record<string, string>;
}

export function resolveLlmOrchestratorImageBaseUrl(
  environment: Record<string, string | undefined> = process.env,
): string {
  const configured = environment.LLM_ORC_URL ?? environment.P_LLM_ORC_URL ?? environment.LLM_ORCHESTRATOR_URL;
  if (!configured) return DEFAULT_LLM_ORCHESTRATOR_BASE_URL;
  const withoutTrailingSlash = configured.replace(/\/+$/, "");
  return withoutTrailingSlash.endsWith("/v1") ? withoutTrailingSlash : `${withoutTrailingSlash}/v1`;
}

export function getImageModel<TProvider extends string, TModelId extends string>(
  provider: TProvider,
  modelId: TModelId,
  options?: ImageModelLookupOptions,
): ImagesModel<ImageModelApi<TProvider, TModelId>> | undefined {
  const providerModels = imageModelRegistry.get(provider);
  const staticModel = providerModels?.get(modelId);
  if (staticModel) {
    return {
      ...staticModel,
      ...(provider === "llm-orchestrator"
        ? { baseUrl: options?.baseUrl ?? resolveLlmOrchestratorImageBaseUrl() }
        : options?.baseUrl
          ? { baseUrl: options.baseUrl }
          : {}),
      ...(options?.headers ? { headers: options.headers } : {}),
    } as ImagesModel<ImageModelApi<TProvider, TModelId>>;
  }

  // Dynamic fallback for custom model IDs for openai / llm-orchestrator
  if (provider === "openai") {
    return {
      id: modelId,
      name: `OpenAI: ${modelId}`,
      api: "openai-images",
      provider: "openai",
      baseUrl: options?.baseUrl ?? "https://api.openai.com/v1",
      ...(options?.headers ? { headers: options.headers } : {}),
      input: ["text"],
      output: ["image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    } as unknown as ImagesModel<ImageModelApi<TProvider, TModelId>>;
  }

  if (provider === "llm-orchestrator") {
    return {
      id: modelId,
      name: `LLM Orchestrator: ${modelId}`,
      api: "openai-images",
      provider: "llm-orchestrator",
      baseUrl: options?.baseUrl ?? resolveLlmOrchestratorImageBaseUrl(),
      ...(options?.headers ? { headers: options.headers } : {}),
      input: ["text"],
      output: ["image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    } as unknown as ImagesModel<ImageModelApi<TProvider, TModelId>>;
  }

  if (options?.baseUrl) {
    return {
      id: modelId,
      name: `${provider}: ${modelId}`,
      api: "openai-images",
      provider,
      baseUrl: options.baseUrl,
      ...(options.headers ? { headers: options.headers } : {}),
      input: ["text"],
      output: ["image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    } as unknown as ImagesModel<ImageModelApi<TProvider, TModelId>>;
  }

  return undefined;
}

export function getImageProviders(): KnownImagesProvider[] {
  return Array.from(imageModelRegistry.keys()) as KnownImagesProvider[];
}

export function getImageModels(provider: string): ImagesModel<ImagesApi>[] {
  const models = imageModelRegistry.get(provider);
  return models ? (Array.from(models.values()) as ImagesModel<ImagesApi>[]) : [];
}
