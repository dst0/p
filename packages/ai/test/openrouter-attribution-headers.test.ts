import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient as createCompletionsClient } from "../src/providers/openai-completions/tool-call-handling.ts";
import { streamOpenAIResponses } from "../src/providers/openai-responses.ts";
import { withOpenRouterAttributionHeaders } from "../src/providers/openrouter-headers.ts";
import type { Context, Model } from "../src/types.ts";

interface OpenAIClientOptions {
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
}

const mockState = vi.hoisted(() => ({
  lastClientOptions: undefined as unknown,
}));

vi.mock("openai", () => {
  class FakeOpenAI {
    responses = {
      create: () => ({
        withResponse: async () => ({
          data: {
            async *[Symbol.asyncIterator]() {
              // The header assertions only require client construction.
            },
          },
          response: { status: 200, headers: new Headers() },
        }),
      }),
    };

    constructor(options: unknown) {
      mockState.lastClientOptions = options;
    }
  }

  return { default: FakeOpenAI };
});

const context: Context = {
  systemPrompt: "",
  messages: [{ role: "user", content: "hello", timestamp: 0 }],
};

function completionsModel(baseUrl: string, headers?: Record<string, string>): Model<"openai-completions"> {
  return {
    id: "openrouter/test",
    name: "OpenRouter Test",
    api: "openai-completions",
    provider: "openrouter",
    baseUrl,
    headers,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 100,
  };
}

function responsesModel(baseUrl: string, headers?: Record<string, string>): Model<"openai-responses"> {
  return {
    id: "openrouter/test",
    name: "OpenRouter Test",
    api: "openai-responses",
    provider: "openrouter",
    baseUrl,
    headers,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 100,
  };
}

function lastClientOptions(): OpenAIClientOptions {
  return mockState.lastClientOptions as OpenAIClientOptions;
}

describe("OpenRouter attribution headers", () => {
  beforeEach(() => {
    mockState.lastClientOptions = undefined;
  });

  it("adds attribution defaults to OpenAI Completions on the exact OpenRouter hostname", () => {
    createCompletionsClient(completionsModel("https://openrouter.ai/api/v1"), context, "test-key");

    expect(lastClientOptions().baseURL).toBe("https://openrouter.ai/api/v1");
    expect(lastClientOptions().defaultHeaders).toMatchObject({
      "HTTP-Referer": "https://github.com/dst0/p",
      "X-OpenRouter-Title": "p",
    });
  });

  it("preserves model and request overrides without case-variant defaults", () => {
    createCompletionsClient(
      completionsModel("https://openrouter.ai/api/v1", {
        "HTTP-Referer": "https://model.example",
        "http-referer": "https://stale-model.example",
        "X-OpenRouter-Title": "Model p",
        "x-openrouter-title": "Stale model p",
      }),
      context,
      "test-key",
      { "http-referer": "https://request.example", "x-openrouter-title": "Custom p" },
    );

    const headers = lastClientOptions().defaultHeaders ?? {};
    expect(headers["http-referer"]).toBe("https://request.example");
    expect(headers["x-openrouter-title"]).toBe("Custom p");
    expect(Object.keys(headers).filter((name) => name.toLowerCase() === "http-referer")).toHaveLength(1);
    expect(Object.keys(headers).filter((name) => name.toLowerCase() === "x-openrouter-title")).toHaveLength(1);
  });

  it("merges OpenRouter layers case-insensitively without mutating inputs", () => {
    const modelHeaders = {
      "HTTP-Referer": "https://model.example",
      "http-referer": "https://stale-model.example",
      "X-Trace": "model-trace",
    };
    const requestHeaders = {
      "HTTP-Referer": "https://request.example",
      "x-trace": "request-trace",
    };

    const headers = withOpenRouterAttributionHeaders("https://openrouter.ai/api/v1", modelHeaders, requestHeaders);

    expect(headers).toEqual({
      "HTTP-Referer": "https://request.example",
      "x-trace": "request-trace",
      "X-OpenRouter-Title": "p",
    });
    expect(modelHeaders).toEqual({
      "HTTP-Referer": "https://model.example",
      "http-referer": "https://stale-model.example",
      "X-Trace": "model-trace",
    });
    expect(requestHeaders).toEqual({
      "HTTP-Referer": "https://request.example",
      "x-trace": "request-trace",
    });
  });

  it("preserves exact object-merge semantics for non-OpenRouter URLs", () => {
    const headers = withOpenRouterAttributionHeaders(
      "https://api.example.com/v1",
      { "HTTP-Referer": "model", "http-referer": "model-alternate" },
      { "HTTP-Referer": "request" },
    );

    expect(headers).toEqual({
      "HTTP-Referer": "request",
      "http-referer": "model-alternate",
    });
  });

  it("preserves own header names that collide with Object prototype setters", () => {
    const modelHeaders = Object.create(null) as Record<string, string>;
    Object.defineProperty(modelHeaders, "__proto__", {
      configurable: true,
      enumerable: true,
      value: "model-header",
      writable: true,
    });

    const headers = withOpenRouterAttributionHeaders("https://api.example.com/v1", modelHeaders);

    expect(Object.hasOwn(headers, "__proto__")).toBe(true);
    expect(headers.__proto__).toBe("model-header");
  });

  it("adds attribution defaults to OpenAI Responses on an OpenRouter subdomain", async () => {
    const stream = streamOpenAIResponses(responsesModel("https://api.openrouter.ai/v1"), context, {
      apiKey: "test-key",
      headers: { "http-referer": "https://custom.example" },
    });
    for await (const event of stream) {
      if (event.type === "done" || event.type === "error") break;
    }

    const headers = lastClientOptions().defaultHeaders ?? {};
    expect(headers["http-referer"]).toBe("https://custom.example");
    expect(headers["X-OpenRouter-Title"]).toBe("p");
    expect(Object.keys(headers).filter((name) => name.toLowerCase() === "http-referer")).toHaveLength(1);
  });

  it.each(["https://openrouter.ai.evil/v1", "https://evilopenrouter.ai/v1", "not a URL"])(
    "does not attribute spoofed or malformed base URL %s",
    (baseUrl) => {
      createCompletionsClient(completionsModel(baseUrl), context, "test-key");

      expect(lastClientOptions().defaultHeaders).not.toHaveProperty("HTTP-Referer");
      expect(lastClientOptions().defaultHeaders).not.toHaveProperty("X-OpenRouter-Title");
    },
  );
});
