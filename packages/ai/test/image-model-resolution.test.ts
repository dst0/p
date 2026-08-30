import { describe, expect, it } from "vitest";
import { getImageModel, resolveLlmOrchestratorImageBaseUrl } from "../src/image-models.ts";

describe("image model endpoint resolution", () => {
  it("normalizes each supported LLM-orchestrator URL environment form", () => {
    expect(resolveLlmOrchestratorImageBaseUrl({ LLM_ORC_URL: "https://one.example///" })).toBe(
      "https://one.example/v1",
    );
    expect(resolveLlmOrchestratorImageBaseUrl({ P_LLM_ORC_URL: "https://two.example/v1/" })).toBe(
      "https://two.example/v1",
    );
    expect(resolveLlmOrchestratorImageBaseUrl({ LLM_ORCHESTRATOR_URL: "https://three.example/api" })).toBe(
      "https://three.example/api/v1",
    );
  });

  it("creates explicit dynamic models for official and orchestrator-compatible endpoints", () => {
    expect(
      getImageModel("openai", "future-image-model", {
        baseUrl: "https://openai.example/v1",
        headers: { "x-client": "p" },
      }),
    ).toMatchObject({
      id: "future-image-model",
      provider: "openai",
      api: "openai-images",
      baseUrl: "https://openai.example/v1",
      headers: { "x-client": "p" },
    });
    expect(getImageModel("llm-orchestrator", "custom-flux", { baseUrl: "http://127.0.0.1:11450/v1" })).toMatchObject({
      id: "custom-flux",
      provider: "llm-orchestrator",
      api: "openai-images",
      baseUrl: "http://127.0.0.1:11450/v1",
    });
  });

  it("rejects an unknown provider without an explicitly configured endpoint", () => {
    expect(getImageModel("unknown-provider", "unknown-model")).toBeUndefined();
  });
});
