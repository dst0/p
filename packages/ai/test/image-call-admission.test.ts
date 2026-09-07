import { afterEach, describe, expect, it, vi } from "vitest";
import { generateImages } from "../src/images.ts";
import { registerImagesApiProvider } from "../src/images-api-registry.ts";
import { registerModelCallGuard } from "../src/model-call-guard.ts";
import type { AssistantImages, ImagesModel } from "../src/types.ts";

const model: ImagesModel<"image-admission-test"> = {
  id: "image",
  name: "image",
  api: "image-admission-test",
  provider: "image-admission-test",
  baseUrl: "",
  input: ["text"],
  output: ["image"],
  cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
};
const result: AssistantImages = {
  api: model.api,
  provider: model.provider,
  model: model.id,
  output: [{ type: "text", text: "Generated preview retained after accounting failure" }],
  stopReason: "stop",
  timestamp: 0,
  usage: {
    input: 2,
    output: 3,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 5,
    cost: { input: 0.000002, output: 0.000003, cacheRead: 0, cacheWrite: 0, total: 0.000005 },
  },
};
let removeGuard: (() => void) | undefined;
afterEach(() => {
  removeGuard?.();
  removeGuard = undefined;
});

describe("image dispatch budget coverage", () => {
  it("admits image dispatch and settles usage before returning the image result", async () => {
    const settle = vi.fn();
    const guard = vi.fn(() => ({ settle }));
    const dispatch = vi.fn(async () => result);
    registerImagesApiProvider({ api: model.api, generateImages: dispatch });
    removeGuard = registerModelCallGuard(guard);
    expect(await generateImages(model, { input: [] })).toEqual(result);
    expect(guard).toHaveBeenCalledExactlyOnceWith({ kind: "image", model, signal: undefined });
    expect(settle).toHaveBeenCalledExactlyOnceWith(result.usage);
  });

  it("does not dispatch or settle an admission denial", async () => {
    const dispatch = vi.fn(async () => result);
    registerImagesApiProvider({ api: model.api, generateImages: dispatch });
    removeGuard = registerModelCallGuard(() => {
      throw new Error("budget_exhausted: requests");
    });
    await expect(generateImages(model, { input: [] })).rejects.toThrow(/budget_exhausted/);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does not count pre-aborted images but counts unknown usage after a failed dispatch", async () => {
    const settle = vi.fn();
    const guard = vi.fn(() => ({ settle }));
    const dispatch = vi.fn(async () => {
      throw new Error("image transport failed");
    });
    registerImagesApiProvider({ api: model.api, generateImages: dispatch });
    removeGuard = registerModelCallGuard(guard);
    expect(await generateImages(model, { input: [] }, { signal: AbortSignal.abort() })).toMatchObject({
      stopReason: "aborted",
      errorMessage: "Request aborted",
      output: [],
    });
    expect(guard).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    await expect(generateImages(model, { input: [] })).rejects.toThrow(/transport failed/);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it("retains generated output without settling twice when receipt persistence fails", async () => {
    const settle = vi.fn(() => {
      throw new Error("budget_storage_error: image receipt");
    });
    registerImagesApiProvider({ api: model.api, generateImages: async () => result });
    removeGuard = registerModelCallGuard(() => ({ settle }));
    expect(await generateImages(model, { input: [] })).toMatchObject({
      output: result.output,
      usage: result.usage,
      stopReason: "error",
      errorMessage: expect.stringContaining("budget_storage_error"),
    });
    expect(settle).toHaveBeenCalledTimes(1);
  });
});
