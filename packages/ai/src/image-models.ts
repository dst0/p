import { IMAGE_MODELS } from "./image-models.generated.ts";
import type { ImagesApi, ImagesModel, KnownImagesProvider } from "./types.ts";

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

export function getImageModel<TProvider extends KnownImagesProvider, TModelId extends string>(
  provider: TProvider,
  modelId: TModelId,
): ImagesModel<ImageModelApi<TProvider, TModelId>> {
  const providerModels = imageModelRegistry.get(provider);
  return providerModels?.get(modelId) as ImagesModel<ImageModelApi<TProvider, TModelId>>;
}

export function getImageProviders(): KnownImagesProvider[] {
  return Array.from(imageModelRegistry.keys()) as KnownImagesProvider[];
}

export function getImageModels<TProvider extends KnownImagesProvider>(provider: TProvider): ImagesModel<ImagesApi>[] {
  const models = imageModelRegistry.get(provider);
  return models ? (Array.from(models.values()) as ImagesModel<ImagesApi>[]) : [];
}
