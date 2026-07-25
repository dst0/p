import { describe, expect, it } from "vitest";
import { isCloudflareProvider, resolveCloudflareBaseUrl } from "../src/providers/cloudflare.ts";
import type { Api, Model } from "../src/types.ts";

describe("cloudflare-unit", () => {
  it("checks if provider is cloudflare", () => {
    expect(isCloudflareProvider("cloudflare-workers-ai")).toBe(true);
    expect(isCloudflareProvider("cloudflare-ai-gateway")).toBe(true);
    expect(isCloudflareProvider("openai")).toBe(false);
  });

  it("resolves cloudflare base URL or throws when env var is missing", () => {
    const model: Model<Api> = {
      id: "cf-model",
      provider: "cloudflare-workers-ai",
      api: "openai-responses" as Api,
      baseUrl: "https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_TEST_ACCOUNT_ID}/ai/v1",
    } as any;

    delete process.env.CLOUDFLARE_TEST_ACCOUNT_ID;
    expect(() => resolveCloudflareBaseUrl(model)).toThrow(
      "CLOUDFLARE_TEST_ACCOUNT_ID is required for provider cloudflare-workers-ai but is not set.",
    );

    process.env.CLOUDFLARE_TEST_ACCOUNT_ID = "acc_123";
    expect(resolveCloudflareBaseUrl(model)).toBe("https://api.cloudflare.com/client/v4/accounts/acc_123/ai/v1");
    delete process.env.CLOUDFLARE_TEST_ACCOUNT_ID;
  });
});
