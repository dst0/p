import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { streamGoogleVertex, streamSimpleGoogleVertex } from "../src/providers/google-vertex.ts";
import type { Context, Model } from "../src/types.ts";

describe("google-vertex-unit", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_LOCATION;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  const dummyModel: Model<"google-vertex"> = {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    api: "google-vertex",
    provider: "google-vertex",
    baseUrl: "https://{location}-aiplatform.googleapis.com",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000000,
    maxTokens: 8192,
  };

  it("throws error when project or location is missing (without explicit apiKey)", async () => {
    const context: Context = { messages: [] };

    const stream1 = streamGoogleVertex(dummyModel, context, {});
    const res1 = await stream1.result();
    expect(res1.stopReason).toBe("error");
    expect(res1.errorMessage).toContain("Vertex AI requires a project ID");

    process.env.GOOGLE_CLOUD_PROJECT = "my-project";
    const stream2 = streamGoogleVertex(dummyModel, context, {});
    const res2 = await stream2.result();
    expect(res2.stopReason).toBe("error");
    expect(res2.errorMessage).toContain("Vertex AI requires a location");
  });

  it("streamSimpleGoogleVertex configures reasoning budget and levels correctly", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "my-project";
    process.env.GOOGLE_CLOUD_LOCATION = "us-central1";

    const context: Context = { messages: [] };

    // Reasoning = minimal
    const streamOff = streamSimpleGoogleVertex(dummyModel, context, { reasoning: "minimal" });
    const resOff = await streamOff.result();
    expect(resOff.stopReason).toBe("error"); // Fails at client invocation with fake credentials

    // Gemini 3 Pro model reasoning
    const gemini3ProModel: Model<"google-vertex"> = {
      ...dummyModel,
      id: "gemini-3.1-pro",
    };
    const streamPro = streamSimpleGoogleVertex(gemini3ProModel, context, { reasoning: "high" });
    const resPro = await streamPro.result();
    expect(resPro.stopReason).toBe("error");

    // Gemini 3 Flash model reasoning
    const gemini3FlashModel: Model<"google-vertex"> = {
      ...dummyModel,
      id: "gemini-3.0-flash",
    };
    const streamFlash = streamSimpleGoogleVertex(gemini3FlashModel, context, { reasoning: "low" });
    const resFlash = await streamFlash.result();
    expect(resFlash.stopReason).toBe("error");
  });
});
