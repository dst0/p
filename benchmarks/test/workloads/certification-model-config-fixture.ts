import { writeFileSync } from "node:fs";
import { join } from "node:path";

export function writeCertifiedModelConfigurationFixture(root: string): { modelsFile: string; kiloConfig: string } {
  const modelsFile = join(root, "models.json");
  const kiloConfig = join(root, "kilo.jsonc");
  writeFileSync(
    modelsFile,
    JSON.stringify({
      providers: {
        backend: {
          api: "openai-completions",
          baseUrl: "http://model.test/v1",
          models: [{ id: "model", contextWindow: 128_000, maxTokens: 8_192, reasoning: false, input: ["text"] }],
        },
      },
    }),
  );
  writeFileSync(
    kiloConfig,
    JSON.stringify({
      provider: {
        backend: {
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: "http://model.test/v1" },
          models: {
            model: {
              tool_call: true,
              reasoning: false,
              limit: { context: 128_000, output: 8_192 },
              modalities: { input: ["text"], output: ["text"] },
            },
          },
        },
      },
    }),
  );
  return { modelsFile, kiloConfig };
}
