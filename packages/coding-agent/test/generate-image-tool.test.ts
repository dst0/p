import type { ImagesModel } from "@dst0/p-ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGenerateImageTool, type GenerateImageOperations } from "../src/core/tools/generate-image.ts";

const mockAiState = vi.hoisted(() => ({
  lastContext: undefined as unknown,
  lastOptions: undefined as unknown,
  mockResponse: undefined as unknown,
}));

vi.mock("@dst0/p-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dst0/p-ai")>();
  return {
    ...actual,
    generateImages: vi.fn().mockImplementation(async (model, context, options) => {
      mockAiState.lastContext = context;
      mockAiState.lastOptions = options;
      if (mockAiState.mockResponse) {
        return mockAiState.mockResponse;
      }
      return {
        api: model.api,
        provider: model.provider,
        model: model.id,
        output: [
          {
            type: "image",
            mimeType: "image/png",
            data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          },
          { type: "text", text: "Revised: a red circle" },
        ],
        stopReason: "stop",
        timestamp: Date.now(),
      };
    }),
  };
});

describe("generate_image tool", () => {
  const dummyModel: ImagesModel<any> = {
    id: "gpt-image-2",
    name: "GPT Image 2",
    api: "openai-images",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    input: ["text"],
    output: ["image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };

  beforeEach(() => {
    mockAiState.lastContext = undefined;
    mockAiState.lastOptions = undefined;
    mockAiState.mockResponse = undefined;
  });

  it("throws error when no image model is configured", async () => {
    const tool = createGenerateImageTool("/workspace");
    await expect(tool.execute("call-1", { prompt: "Generate a sunset" })).rejects.toThrow(
      "No image generation model configured",
    );
  });

  it("generates image and atomically writes file via temp file and rename", async () => {
    const operationsLog: string[] = [];
    const writtenFiles = new Map<string, Buffer>();
    const createdDirs = new Set<string>();

    const mockOperations: GenerateImageOperations = {
      writeFile: async (filePath, buffer, _signal) => {
        operationsLog.push(`write:${filePath}`);
        writtenFiles.set(filePath, buffer);
      },
      rename: async (oldPath, newPath) => {
        operationsLog.push(`rename:${oldPath}->${newPath}`);
        const data = writtenFiles.get(oldPath);
        if (data) {
          writtenFiles.set(newPath, data);
          writtenFiles.delete(oldPath);
        }
      },
      unlink: async (path) => {
        operationsLog.push(`unlink:${path}`);
        writtenFiles.delete(path);
      },
      mkdir: async (dir) => {
        operationsLog.push(`mkdir:${dir}`);
        createdDirs.add(dir);
      },
    };

    const controller = new AbortController();
    const tool = createGenerateImageTool("/workspace", {
      model: dummyModel,
      apiKey: "test-api-key",
      headers: { "x-image-client": "p" },
      operations: mockOperations,
    });

    const result = await tool.execute(
      "call-1",
      {
        prompt: "A beautiful forest",
        outputPath: "assets/forest.png",
        aspectRatio: "16:9",
      },
      controller.signal,
    );

    expect(result.content[0].type).toBe("text");
    expect((result.content[0] as { text: string }).text).toContain("Successfully generated image");
    expect(result.details?.outputPath).toBe("assets/forest.png");
    expect(result.details?.provider).toBe("openai");
    expect(result.details?.model).toBe("gpt-image-2");
    expect(mockAiState.lastContext).toEqual({ input: [{ type: "text", text: "A beautiful forest" }] });
    expect(mockAiState.lastOptions).toMatchObject({
      apiKey: "test-api-key",
      headers: { "x-image-client": "p" },
      signal: controller.signal,
      size: "1792x1024",
    });
    expect((mockAiState.lastOptions as { downloadImage?: unknown }).downloadImage).toEqual(expect.any(Function));

    expect(createdDirs.has("/workspace/assets")).toBe(true);
    expect(writtenFiles.has("/workspace/assets/forest.png")).toBe(true);

    const writeIdx = operationsLog.findIndex((op) => op.startsWith("write:/workspace/assets/forest.png.tmp"));
    const renameIdx = operationsLog.findIndex((op) => op.startsWith("rename:/workspace/assets/forest.png.tmp"));
    expect(writeIdx).toBeGreaterThanOrEqual(0);
    expect(renameIdx).toBeGreaterThanOrEqual(0);
    expect(writeIdx).toBeLessThan(renameIdx);
  });

  it("cleans up temp file when write operation fails", async () => {
    const unlinkedPaths: string[] = [];

    const mockOperations: GenerateImageOperations = {
      writeFile: async () => {
        throw new Error("Disk full");
      },
      rename: async () => {},
      unlink: async (path) => {
        unlinkedPaths.push(path);
      },
      mkdir: async () => {},
    };

    const tool = createGenerateImageTool("/workspace", {
      model: dummyModel,
      apiKey: "test-api-key",
      operations: mockOperations,
    });

    await expect(tool.execute("call-fail", { prompt: "A failure test", outputPath: "fail.png" })).rejects.toThrow(
      "Disk full",
    );
    expect(unlinkedPaths.length).toBe(1);
    expect(unlinkedPaths[0]).toContain("fail.png.tmp");
  });

  it("cleans up the temp file and preserves the target when rename fails", async () => {
    const targetPath = "/workspace/existing.png";
    const files = new Map<string, Buffer>([[targetPath, Buffer.from("existing")]]);
    const unlinkedPaths: string[] = [];
    const operations: GenerateImageOperations = {
      writeFile: async (path, buffer) => {
        files.set(path, buffer);
      },
      rename: async () => {
        throw new Error("rename failed");
      },
      unlink: async (path) => {
        unlinkedPaths.push(path);
        files.delete(path);
      },
      mkdir: async () => {},
    };
    const tool = createGenerateImageTool("/workspace", {
      model: dummyModel,
      apiKey: "test-api-key",
      operations,
    });

    await expect(
      tool.execute("call-rename-fail", { prompt: "A failure test", outputPath: "existing.png" }),
    ).rejects.toThrow("rename failed");
    expect(files.get(targetPath)?.toString()).toBe("existing");
    expect(unlinkedPaths).toHaveLength(1);
    expect(unlinkedPaths[0]).toContain("existing.png.tmp");
  });

  it("throws error on conflicting size and aspectRatio including 1024x1024 vs 16:9", async () => {
    const tool = createGenerateImageTool("/workspace", {
      model: dummyModel,
      apiKey: "test-api-key",
    });

    await expect(tool.execute("call-c1", { prompt: "Test", size: "1792x1024", aspectRatio: "9:16" })).rejects.toThrow(
      "Conflicting size",
    );

    await expect(tool.execute("call-c2", { prompt: "Test", size: "1024x1024", aspectRatio: "16:9" })).rejects.toThrow(
      "Conflicting size",
    );

    await expect(tool.execute("call-c3", { prompt: "Test", aspectRatio: "invalid-ratio" })).rejects.toThrow(
      "Invalid aspectRatio format",
    );
  });

  it("fails closed when provider returns invalid binary image data", async () => {
    mockAiState.mockResponse = {
      api: "openai-images",
      provider: "openai",
      model: "dall-e-3",
      output: [
        { type: "image", mimeType: "image/png", data: Buffer.from("<html>not an image</html>").toString("base64") },
      ],
      stopReason: "stop",
      timestamp: Date.now(),
    };

    const tool = createGenerateImageTool("/workspace", {
      model: dummyModel,
      apiKey: "test-api-key",
    });

    await expect(tool.execute("call-invalid-magic", { prompt: "test" })).rejects.toThrow(
      "unrecognized or invalid binary format",
    );
  });

  it("rejects an explicit output extension that conflicts with detected image bytes", async () => {
    const operations: GenerateImageOperations = {
      writeFile: vi.fn(),
      rename: vi.fn(),
      unlink: vi.fn(),
      mkdir: vi.fn(),
    };
    const tool = createGenerateImageTool("/workspace", {
      model: dummyModel,
      apiKey: "test-api-key",
      operations,
    });

    await expect(
      tool.execute("call-extension-mismatch", { prompt: "test", outputPath: "generated.jpg" }),
    ).rejects.toThrow("does not match generated image type");
    expect(operations.writeFile).not.toHaveBeenCalled();
  });

  it("aborts and cleans up temp file when signal fires during write", async () => {
    const controller = new AbortController();
    const unlinkedPaths: string[] = [];

    const mockOperations: GenerateImageOperations = {
      writeFile: async () => {
        controller.abort();
        throw new Error("Operation aborted");
      },
      rename: async () => {},
      unlink: async (path) => {
        unlinkedPaths.push(path);
      },
      mkdir: async () => {},
    };

    const tool = createGenerateImageTool("/workspace", {
      model: dummyModel,
      apiKey: "test-api-key",
      operations: mockOperations,
    });

    await expect(
      tool.execute("call-abort", { prompt: "Abort test", outputPath: "aborted.png" }, controller.signal),
    ).rejects.toThrow("aborted");
    expect(unlinkedPaths.length).toBe(1);
    expect(unlinkedPaths[0]).toContain("aborted.png.tmp");
  });
});
