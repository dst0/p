import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  streamAzureOpenAIResponses,
  streamSimpleAzureOpenAIResponses,
} from "../src/providers/azure-openai-responses.ts";
import type { Context, Model } from "../src/types.ts";

const mockResponsesCreate = vi.fn();

vi.mock("openai", () => {
  return {
    AzureOpenAI: vi.fn().mockImplementation(function (
      this: { options?: unknown; responses?: unknown },
      options: unknown,
    ) {
      this.options = options;
      this.responses = {
        create: mockResponsesCreate,
      };
    }),
  };
});

describe("azure-openai-responses comprehensive coverage", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...origEnv };
    delete process.env.AZURE_OPENAI_DEPLOYMENT_NAME_MAP;
    delete process.env.AZURE_OPENAI_BASE_URL;
    delete process.env.AZURE_OPENAI_RESOURCE_NAME;
    delete process.env.AZURE_OPENAI_API_VERSION;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  const dummyModel: Model<"azure-openai-responses"> = {
    id: "gpt-4o-realtime",
    name: "GPT-4o Realtime",
    api: "azure-openai-responses",
    provider: "azure-openai",
    baseUrl: "https://my-resource.openai.azure.com",
    reasoning: true,
    thinkingLevelMap: { high: "high", off: "none" },
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  };

  it("throws error if no API key is provided", async () => {
    const context: Context = { messages: [] };
    const stream = streamAzureOpenAIResponses(dummyModel, context, {});
    const res = await stream.result();
    expect(res.stopReason).toBe("error");
    expect(res.errorMessage).toBe("No API key for provider: azure-openai");

    expect(() => streamSimpleAzureOpenAIResponses(dummyModel, context, {})).toThrow(
      "No API key for provider: azure-openai",
    );
  });

  it("throws error if Azure OpenAI base URL cannot be resolved", async () => {
    const modelNoBaseUrl = { ...dummyModel, baseUrl: "" };
    const context: Context = { messages: [] };
    const stream = streamAzureOpenAIResponses(modelNoBaseUrl, context, { apiKey: "key" });
    const res = await stream.result();
    expect(res.stopReason).toBe("error");
    expect(res.errorMessage).toContain("Azure OpenAI base URL is required");
  });

  it("throws error for invalid Azure OpenAI base URL format", async () => {
    const context: Context = { messages: [] };
    const stream = streamAzureOpenAIResponses(dummyModel, context, {
      apiKey: "key",
      azureBaseUrl: "not-a-valid-url",
    });
    const res = await stream.result();
    expect(res.stopReason).toBe("error");
    expect(res.errorMessage).toContain("Invalid Azure OpenAI base URL");
  });

  it("handles deployment mapping from environment variable and options", async () => {
    process.env.AZURE_OPENAI_DEPLOYMENT_NAME_MAP = "gpt-4o-realtime=dep-gpt4o-mapped,other=other-dep";

    async function* asyncStream() {
      yield { type: "response.done", response: { output: [], status: "completed" } };
    }
    const mockWithResponse = vi.fn().mockResolvedValue({
      data: asyncStream(),
      response: { status: 200, headers: new Headers() },
    });
    mockResponsesCreate.mockReturnValue({ withResponse: mockWithResponse });

    const context: Context = { messages: [{ role: "user", content: "hi", timestamp: 0 }] };
    const onResponse = vi.fn();

    const stream = streamAzureOpenAIResponses(dummyModel, context, {
      apiKey: "key",
      onResponse,
      reasoningEffort: "high",
      reasoningSummary: "detailed",
      azureApiVersion: "2024-10-01-preview",
    });

    const res = await stream.result();
    expect(res.stopReason).toBe("stop");
    expect(onResponse).toHaveBeenCalled();

    const params = mockResponsesCreate.mock.calls[0][0];
    expect(params.model).toBe("dep-gpt4o-mapped");
    expect(params.reasoning).toEqual({ effort: "high", summary: "detailed" });
  });

  it("handles resource name resolution when azureBaseUrl is not provided", async () => {
    process.env.AZURE_OPENAI_RESOURCE_NAME = "test-resource";

    async function* asyncStream() {
      yield { type: "response.done", response: { output: [], status: "completed" } };
    }
    const mockWithResponse = vi.fn().mockResolvedValue({
      data: asyncStream(),
      response: { status: 200, headers: new Headers() },
    });
    mockResponsesCreate.mockReturnValue({ withResponse: mockWithResponse });

    const modelNoBase = { ...dummyModel, baseUrl: "" };
    const context: Context = { messages: [] };
    const stream = streamAzureOpenAIResponses(modelNoBase, context, {
      apiKey: "key",
      azureDeploymentName: "explicit-dep",
    });

    const res = await stream.result();
    expect(res.stopReason).toBe("stop");

    const params = mockResponsesCreate.mock.calls[0][0];
    expect(params.model).toBe("explicit-dep");
  });

  it("formats API errors with status codes and handles non-error objects", async () => {
    const errorWithStatus = new Error("Deployment not found") as Error & { status?: number };
    errorWithStatus.status = 404;
    const mockWithResponse = vi.fn().mockRejectedValue(errorWithStatus);
    mockResponsesCreate.mockReturnValue({ withResponse: mockWithResponse });

    const context: Context = { messages: [] };
    const stream = streamAzureOpenAIResponses(dummyModel, context, { apiKey: "key" });
    const res = await stream.result();

    expect(res.stopReason).toBe("error");
    expect(res.errorMessage).toBe("Azure OpenAI API error (404): Deployment not found");
  });
});
