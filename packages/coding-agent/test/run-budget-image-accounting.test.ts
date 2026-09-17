import { generateImages, type ImagesModel } from "@dst0/p-ai";
import { describe, expect, it, vi } from "vitest";
import { SessionRunBudget } from "../src/core/run-budget/session-run-budget.ts";
import { SessionManager } from "../src/core/session-manager.ts";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const openRouterModel: ImagesModel<"openrouter-images"> = {
  id: "image-priced-per-output",
  name: "Image priced per output",
  api: "openrouter-images",
  provider: "openrouter",
  baseUrl: "https://openrouter.ai/api/v1",
  input: ["text"],
  output: ["image"],
  cost: { input: 0, output: 0.04, cacheRead: 0, cacheWrite: 0 },
};

const openAIModel: ImagesModel<"openai-images"> = {
  id: "gpt-image-2",
  name: "GPT Image 2",
  api: "openai-images",
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  input: ["text"],
  output: ["image"],
  cost: { input: 0, output: 0.04, cacheRead: 0, cacheWrite: 0 },
};

function openRouterResponse(usage: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      id: "generation-1",
      usage,
      choices: [{ message: { images: [{ image_url: `data:image/png;base64,${PNG_BASE64}` }] } }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function openAIResponse(): Response {
  return new Response(JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function openRouterFetch(metadata: unknown): ReturnType<typeof vi.fn<typeof globalThis.fetch>> {
  return vi.fn<typeof globalThis.fetch>(async (input) =>
    String(input).includes("/generation?")
      ? metadata instanceof Response
        ? metadata
        : new Response(JSON.stringify(metadata), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
      : openRouterResponse({ cost: 0.04 }),
  );
}

describe("run-budget image accounting", () => {
  it("uses provider-reported USD when image token counts and input pricing are absent", async () => {
    const budget = new SessionRunBudget(SessionManager.inMemory(), {
      runBudget: { mode: "limited", unit: "usd", limit: 0.1 },
    });

    const fetch = openRouterFetch({ data: { is_byok: false, total_cost: 0.04, upstream_inference_cost: 0.03 } });
    const result = await budget.run(() =>
      generateImages(openRouterModel, { input: [{ type: "text", text: "draw" }] }, { apiKey: "test-key", fetch }),
    );

    expect(result.stopReason).toBe("stop");
    expect(budget.snapshot()).toMatchObject({
      requests: 1,
      tokens: 0,
      usd: 0.04,
      uncertainTokens: true,
      uncertainUsd: false,
      status: "ready",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("preserves an independently reported zero image charge", async () => {
    const budget = new SessionRunBudget(SessionManager.inMemory(), {
      runBudget: { mode: "limited", unit: "usd", limit: 0.1 },
    });
    const fetch = openRouterFetch({ data: { is_byok: false, total_cost: 0 } });

    await expect(
      budget.run(() =>
        generateImages(openRouterModel, { input: [{ type: "text", text: "draw" }] }, { apiKey: "test-key", fetch }),
      ),
    ).resolves.toMatchObject({ stopReason: "stop", reportedUsd: 0 });
    expect(budget.snapshot()).toMatchObject({ requests: 1, usd: 0, uncertainUsd: false, status: "ready" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("fails closed after OpenRouter metadata is unavailable and does not dispatch again", async () => {
    const fetch = openRouterFetch(new Response("unavailable", { status: 503 }));
    const budget = new SessionRunBudget(SessionManager.inMemory(), {
      runBudget: { mode: "limited", unit: "usd", limit: 0.1 },
    });
    const run = () =>
      budget.run(() =>
        generateImages(openRouterModel, { input: [{ type: "text", text: "draw" }] }, { apiKey: "test-key", fetch }),
      );

    const result = await run();
    expect(result.stopReason).toBe("stop");
    expect(result.reportedUsd).toBeUndefined();
    expect(budget.snapshot()).toMatchObject({ requests: 1, usd: 0, uncertainUsd: true, status: "uncertain" });
    await expect(run()).rejects.toThrow(/budget_uncertain/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("cancels oversized chunked metadata and blocks another USD dispatch without losing the image", async () => {
    const cancel = vi.fn();
    const metadataBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(32 * 1024));
      },
      cancel,
    });
    const fetch = openRouterFetch(new Response(metadataBody, { status: 200 }));
    const budget = new SessionRunBudget(SessionManager.inMemory(), {
      runBudget: { mode: "limited", unit: "usd", limit: 0.1 },
    });
    const run = () =>
      budget.run(() =>
        generateImages(openRouterModel, { input: [{ type: "text", text: "draw" }] }, { apiKey: "test-key", fetch }),
      );

    const result = await run();
    expect(result.stopReason).toBe("stop");
    expect(result.output).toHaveLength(1);
    expect(result.reportedUsd).toBeUndefined();
    expect(cancel).toHaveBeenCalledOnce();
    expect(budget.snapshot()).toMatchObject({ requests: 1, usd: 0, uncertainUsd: true, status: "uncertain" });
    await expect(run()).rejects.toThrow(/budget_uncertain/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    { unit: "tokens" as const, limit: 100, model: openRouterModel, expected: /token usage/i },
    { unit: "tokens" as const, limit: 100, model: openAIModel, expected: /token usage/i },
    {
      unit: "usd" as const,
      limit: 1,
      model: { ...openAIModel, cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } },
      expected: /USD cost/i,
    },
  ])("rejects unsupported $unit accounting before dispatch without poisoning the task", async (testCase) => {
    const fetch = vi.fn(async () => openAIResponse());
    const budget = new SessionRunBudget(SessionManager.inMemory(), {
      runBudget: { mode: "limited", unit: testCase.unit, limit: testCase.limit },
    });

    await expect(
      budget.run(() =>
        generateImages(testCase.model, { input: [{ type: "text", text: "draw" }] }, { apiKey: "test-key", fetch }),
      ),
    ).rejects.toThrow(testCase.expected);
    expect(fetch).not.toHaveBeenCalled();
    expect(budget.snapshot()).toMatchObject({ requests: 0, pending: 0, status: "ready" });
  });

  it("keeps request budgets exact for image APIs without usage reports", async () => {
    const fetch = vi.fn(async () => openAIResponse());
    const budget = new SessionRunBudget(SessionManager.inMemory(), {
      runBudget: { mode: "limited", unit: "requests", limit: 1 },
    });
    const run = () =>
      budget.run(() =>
        generateImages(openAIModel, { input: [{ type: "text", text: "draw" }] }, { apiKey: "test-key", fetch }),
      );

    await expect(run()).resolves.toMatchObject({ stopReason: "stop" });
    await expect(run()).rejects.toThrow(/budget_exhausted/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(budget.snapshot()).toMatchObject({ requests: 1, pending: 0, status: "exhausted" });
  });
});
