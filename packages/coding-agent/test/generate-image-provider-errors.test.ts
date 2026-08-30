import type { AssistantImages, ImagesModel } from "@dst0/p-ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGenerateImageTool, type GenerateImageOperations } from "../src/core/tools/generate-image.ts";

const mockState = vi.hoisted(() => ({ response: undefined as AssistantImages | undefined }));

vi.mock("@dst0/p-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dst0/p-ai")>();
  return {
    ...actual,
    generateImages: vi.fn(async () => mockState.response),
  };
});

const model: ImagesModel<"openai-images"> = {
  id: "flux2-klein-4b",
  name: "LLM Orchestrator: FLUX.2 Klein 4B",
  api: "openai-images",
  provider: "llm-orchestrator",
  baseUrl: "http://127.0.0.1:11450/v1",
  input: ["text"],
  output: ["image"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

const imageData = {
  jpeg: Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0, 1, 0, 1, 1, 1, 0x11, 0, 0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 0, 0xff,
    0xd9,
  ]).toString("base64"),
  webp: "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA",
  gif: "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
  png: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
};

function response(
  output: AssistantImages["output"],
  stopReason: AssistantImages["stopReason"] = "stop",
): AssistantImages {
  return {
    api: "openai-images",
    provider: "llm-orchestrator",
    model: model.id,
    output,
    stopReason,
    timestamp: Date.now(),
  };
}

function memoryOperations(): GenerateImageOperations {
  return {
    writeFile: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    unlink: vi.fn(async () => {}),
    mkdir: vi.fn(async () => {}),
  };
}

describe("generate_image provider result contracts", () => {
  beforeEach(() => {
    mockState.response = response([{ type: "image", mimeType: "image/png", data: imageData.png }]);
  });

  it("maps each supported binary envelope to its safe output extension", async () => {
    for (const [kind, expectedExtension] of [
      ["jpeg", "jpg"],
      ["webp", "webp"],
      ["gif", "gif"],
    ] as const) {
      mockState.response = response([{ type: "image", mimeType: `image/${kind}`, data: imageData[kind] }]);
      const tool = createGenerateImageTool("/workspace", { model, operations: memoryOperations() });
      const result = await tool.execute(kind, { prompt: `draw ${kind}`, outputPath: `asset.${expectedExtension}` });
      expect(result.details?.outputPath).toBe(`asset.${expectedExtension}`);
    }
  });

  it("rejects unsupported output extensions before publication", async () => {
    const operations = memoryOperations();
    const tool = createGenerateImageTool("/workspace", { model, operations });
    await expect(tool.execute("unsupported", { prompt: "draw", outputPath: "asset.bmp" })).rejects.toThrow(
      'Unsupported image output extension ".bmp"',
    );
    expect(operations.writeFile).not.toHaveBeenCalled();
  });

  it("preserves explicit provider errors and handles fallback, abort, and missing-image outcomes", async () => {
    const tool = createGenerateImageTool("/workspace", { model, operations: memoryOperations() });
    mockState.response = { ...response([], "error"), errorMessage: "provider overloaded" };
    await expect(tool.execute("provider-error", { prompt: "draw" })).rejects.toThrow("provider overloaded");

    mockState.response = response([], "error");
    await expect(tool.execute("error", { prompt: "draw" })).rejects.toThrow("Image generation failed");

    mockState.response = response([], "aborted");
    await expect(tool.execute("aborted", { prompt: "draw" })).rejects.toThrow("Image generation aborted");

    mockState.response = response([{ type: "text", text: "no binary output" }]);
    await expect(tool.execute("missing", { prompt: "draw" })).rejects.toThrow("No image data returned");
  });
});
