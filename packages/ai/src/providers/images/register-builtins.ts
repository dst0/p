import { registerImagesApiProvider } from "../../images-api-registry.ts";
import { generateImagesOpenAI } from "./openai.ts";
import { generateImagesOpenRouter } from "./openrouter.ts";

export function registerBuiltInImagesApiProviders(): void {
  registerImagesApiProvider({
    api: "openrouter-images",
    generateImages: generateImagesOpenRouter,
    modelCallAccounting: { tokens: "unsupported", usd: "reported" },
  });
  registerImagesApiProvider({
    api: "openai-images",
    generateImages: generateImagesOpenAI,
    modelCallAccounting: { tokens: "unsupported", usd: "unsupported" },
  });
}

registerBuiltInImagesApiProviders();
