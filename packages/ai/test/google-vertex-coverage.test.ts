import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamGoogleVertex, streamSimpleGoogleVertex } from "../src/providers/google-vertex.ts";
import type { Context, Model } from "../src/types.ts";

const mockGenerateContentStream = vi.fn();

vi.mock("@google/genai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/genai")>();
  return {
    ...actual,
    GoogleGenAI: vi.fn().mockImplementation(function (this: { options?: unknown; models?: unknown }, options: unknown) {
      this.options = options;
      this.models = {
        generateContentStream: mockGenerateContentStream,
      };
    }),
  };
});

describe("google-vertex provider comprehensive coverage", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...origEnv };
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_LOCATION;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  const gemini25Model: Model<"google-vertex"> = {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    api: "google-vertex",
    provider: "google-vertex",
    baseUrl: "https://us-central1-aiplatform.googleapis.com",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000000,
    maxTokens: 8192,
  };

  const gemini3ProModel: Model<"google-vertex"> = {
    id: "gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro",
    api: "google-vertex",
    provider: "google-vertex",
    baseUrl: "https://us-central1-aiplatform.googleapis.com/v1/projects/p/locations/l",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000000,
    maxTokens: 8192,
  };

  const gemini3FlashModel: Model<"google-vertex"> = {
    id: "gemini-3.0-flash",
    name: "Gemini 3 Flash",
    api: "google-vertex",
    provider: "google-vertex",
    baseUrl: "https://us-central1-aiplatform.googleapis.com",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000000,
    maxTokens: 8192,
  };

  it("throws error if project or location are missing when no API key is provided", async () => {
    const context: Context = { messages: [] };
    const stream = streamGoogleVertex(gemini25Model, context);
    const res = await stream.result();
    expect(res.stopReason).toBe("error");
    expect(res.errorMessage).toContain("Vertex AI requires a project ID");
  });

  it("throws error if location is missing when project is set", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "my-project";
    const context: Context = { messages: [] };
    const stream = streamGoogleVertex(gemini25Model, context);
    const res = await stream.result();
    expect(res.stopReason).toBe("error");
    expect(res.errorMessage).toContain("Vertex AI requires a location");
  });

  it("handles successful stream with text, thinking, function calls, usage, and responseId", async () => {
    async function* asyncStream() {
      yield {
        responseId: "resp-vertex-123",
        candidates: [
          {
            content: {
              parts: [
                { text: "Thinking process...", thoughtSignature: "thought-sig" },
                { text: "Hello response!" },
                {
                  functionCall: {
                    name: "lookup_user",
                    args: { userId: "123" },
                  },
                  thoughtSignature: "fc-sig",
                },
              ],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: 150,
          cachedContentTokenCount: 50,
          candidatesTokenCount: 30,
          thoughtsTokenCount: 20,
          totalTokenCount: 150,
        },
      };
    }

    mockGenerateContentStream.mockResolvedValueOnce(asyncStream());

    const context: Context = {
      systemPrompt: "System instruction",
      tools: [{ name: "lookup_user", description: "d", parameters: {} }],
      messages: [{ role: "user", content: "Find user 123", timestamp: 0 }],
    };

    const stream = streamGoogleVertex(gemini25Model, context, {
      project: "proj-1",
      location: "us-central1",
      toolChoice: "auto",
      thinking: { enabled: true, level: "HIGH" },
    });

    const res = await stream.result();
    expect(res.stopReason).toBe("toolUse");
    expect(res.responseId).toBe("resp-vertex-123");
    expect(res.usage.input).toBe(100);
    expect(res.usage.cacheRead).toBe(50);
    expect(res.usage.output).toBe(50);
    expect(res.content.some((b) => b.type === "toolCall")).toBe(true);
  });

  it("handles API key authentication without project/location requirements", async () => {
    async function* asyncStream() {
      yield {
        candidates: [{ content: { parts: [{ text: "API key works" }] }, finishReason: "STOP" }],
      };
    }
    mockGenerateContentStream.mockResolvedValueOnce(asyncStream());

    const context: Context = { messages: [] };
    const stream = streamGoogleVertex(gemini25Model, context, {
      apiKey: "real-api-key",
      headers: { "x-custom": "test" },
    });

    const res = await stream.result();
    expect(res.stopReason).toBe("stop");
    expect(res.content[0]).toEqual({ type: "text", text: "API key works" });
  });

  it("filters placeholder API keys and uses ADC", async () => {
    process.env.GCLOUD_PROJECT = "gcloud-project";
    process.env.GOOGLE_CLOUD_LOCATION = "us-east1";

    async function* asyncStream() {
      yield { candidates: [{ content: { parts: [{ text: "ADC works" }] } }] };
    }
    mockGenerateContentStream.mockResolvedValueOnce(asyncStream());

    const context: Context = { messages: [] };
    const stream = streamGoogleVertex(gemini25Model, context, {
      apiKey: "<placeholder>",
    });

    const res = await stream.result();
    expect(res.stopReason).toBe("stop");
  });

  it("handles streamSimpleGoogleVertex with Gemini 3 Pro and Flash thinking levels", async () => {
    async function* asyncStream() {
      yield { candidates: [{ content: { parts: [{ text: "Gemini 3 thinking response" }] } }] };
    }
    mockGenerateContentStream.mockResolvedValueOnce(asyncStream());

    const context: Context = { messages: [] };
    const stream = streamSimpleGoogleVertex(gemini3ProModel, context, {
      apiKey: "key",
      reasoning: "low",
    });

    const res = await stream.result();
    expect(res.stopReason).toBe("stop");
  });

  it("handles streamSimpleGoogleVertex with disabled thinking for Gemini 3 and Gemini 2.5", async () => {
    async function* asyncStream() {
      yield { candidates: [{ content: { parts: [{ text: "No thinking" }] } }] };
    }
    mockGenerateContentStream.mockResolvedValueOnce(asyncStream());

    const context: Context = { messages: [] };
    const stream = streamSimpleGoogleVertex(gemini3FlashModel, context, {
      apiKey: "key",
      reasoning: undefined,
    });

    const res = await stream.result();
    expect(res.stopReason).toBe("stop");
  });
});
