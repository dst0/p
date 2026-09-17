import { describe, expect, it, vi } from "vitest";
import { generateImagesOpenRouter } from "../src/providers/images/openrouter.ts";
import type { ImagesModel } from "../src/types.ts";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const model: ImagesModel<"openrouter-images"> = {
  id: "google/imagen-3",
  name: "Imagen 3",
  api: "openrouter-images",
  provider: "openrouter",
  baseUrl: "https://openrouter.ai/api/v1",
  input: ["text"],
  output: ["image"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

async function generateWithMetadata(
  metadata: unknown,
  responseId: string | null = "generation /?encoded",
  inlineUsage: Record<string, unknown> = { prompt_tokens: 3, completion_tokens: 7, total_tokens: 10 },
) {
  const controller = new AbortController();
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const url = String(input);
    if (url.endsWith("/chat/completions")) {
      return new Response(
        JSON.stringify({
          ...(responseId === null ? {} : { id: responseId }),
          usage: inlineUsage,
          choices: [{ message: { images: [{ image_url: `data:image/png;base64,${PNG_BASE64}` }] } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return metadata instanceof Response
      ? metadata
      : new Response(JSON.stringify(metadata), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
  });
  const result = await generateImagesOpenRouter(
    model,
    { input: [{ type: "text", text: "draw" }] },
    {
      apiKey: "dummy-key",
      headers: { "x-accounting-test": "present" },
      signal: controller.signal,
      fetch,
    },
  );
  return { result, fetch, signal: controller.signal };
}

describe("OpenRouter image cost accounting", () => {
  it("performs an authenticated metadata GET after the image POST", async () => {
    const { result, fetch, signal } = await generateWithMetadata({
      data: { is_byok: false, total_cost: 0.04, upstream_inference_cost: 0.03 },
    });

    expect(result).toMatchObject({ stopReason: "stop", reportedUsd: 0.04 });
    expect(result.usage?.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([input, init]) => ({ url: String(input), method: init?.method }))).toEqual([
      { url: "https://openrouter.ai/api/v1/chat/completions", method: "POST" },
      {
        url: "https://openrouter.ai/api/v1/generation?id=generation%20%2F%3Fencoded",
        method: "GET",
      },
    ]);
    const metadataHeaders = new Headers(fetch.mock.calls[1][1]?.headers);
    expect(metadataHeaders.get("authorization")).toBe("Bearer dummy-key");
    expect(metadataHeaders.get("x-accounting-test")).toBe("present");
    expect(fetch.mock.calls[0][1]?.signal).toBe(signal);
    expect(fetch.mock.calls[1][1]?.signal).toBe(signal);
  });

  it("adds the OpenRouter account and upstream costs for BYOK", async () => {
    const { result } = await generateWithMetadata({
      data: { is_byok: true, total_cost: 0.01, upstream_inference_cost: 0.09 },
    });
    expect(result.reportedUsd).toBe(0.01 + 0.09);
  });

  it("uses GET metadata when inline billing fields contradict it", async () => {
    const { result } = await generateWithMetadata(
      { data: { is_byok: false, total_cost: 0.04, upstream_inference_cost: 0.03 } },
      "generation-contradictory",
      {
        prompt_tokens: 3,
        completion_tokens: 7,
        total_tokens: 10,
        is_byok: true,
        cost: 4,
        cost_details: { upstream_inference_cost: 8 },
      },
    );

    expect(result.reportedUsd).toBe(0.04);
  });

  it("does not fall back to inline billing fields when GET metadata is malformed", async () => {
    const { result } = await generateWithMetadata(
      { data: { is_byok: "false", total_cost: "0.04" } },
      "generation-malformed",
      {
        prompt_tokens: 3,
        completion_tokens: 7,
        total_tokens: 10,
        is_byok: false,
        cost: 0.04,
        cost_details: { upstream_inference_cost: 0.03 },
      },
    );

    expect(result.reportedUsd).toBeUndefined();
  });

  it.each([
    { name: "missing data", metadata: {} },
    { name: "missing BYOK metadata", metadata: { data: { total_cost: 0.04 } } },
    { name: "malformed BYOK metadata", metadata: { data: { total_cost: 0.04, is_byok: "false" } } },
    { name: "missing non-BYOK total cost", metadata: { data: { is_byok: false } } },
    { name: "malformed non-BYOK total cost", metadata: { data: { total_cost: -1, is_byok: false } } },
    { name: "missing BYOK upstream cost", metadata: { data: { total_cost: 0.01, is_byok: true } } },
    {
      name: "malformed BYOK upstream cost",
      metadata: { data: { total_cost: 0.01, is_byok: true, upstream_inference_cost: "unknown" } },
    },
  ])("treats reported USD as unknown for $name", async ({ metadata }) => {
    expect((await generateWithMetadata(metadata)).result.reportedUsd).toBeUndefined();
  });

  it.each([
    { name: "non-BYOK", metadata: { data: { total_cost: 0, is_byok: false } } },
    { name: "BYOK", metadata: { data: { total_cost: 0, is_byok: true, upstream_inference_cost: 0 } } },
  ])("preserves an authoritative zero $name charge", async ({ metadata }) => {
    expect((await generateWithMetadata(metadata)).result.reportedUsd).toBe(0);
  });

  it("retains the generated image when metadata lookup fails", async () => {
    const { result } = await generateWithMetadata(new Response("unavailable", { status: 503 }));
    expect(result.stopReason).toBe("stop");
    expect(result.reportedUsd).toBeUndefined();
    expect(result.output).toEqual([{ type: "image", mimeType: "image/png", data: PNG_BASE64 }]);
  });

  it("retains the image and skips metadata lookup when the generation ID is absent", async () => {
    const { result, fetch } = await generateWithMetadata({ data: { is_byok: false, total_cost: 0.04 } }, null);

    expect(result.stopReason).toBe("stop");
    expect(result.reportedUsd).toBeUndefined();
    expect(result.output).toEqual([{ type: "image", mimeType: "image/png", data: PNG_BASE64 }]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("bounds generation metadata responses without discarding the image", async () => {
    const oversized = new Response("not read", {
      status: 200,
      headers: { "content-length": String(64 * 1024 + 1) },
    });
    const { result } = await generateWithMetadata(oversized);

    expect(result.stopReason).toBe("stop");
    expect(result.reportedUsd).toBeUndefined();
    expect(result.output).toEqual([{ type: "image", mimeType: "image/png", data: PNG_BASE64 }]);
  });
});
