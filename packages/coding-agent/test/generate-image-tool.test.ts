import type { ImagesModel } from "@dst0/p-ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGenerateImageTool,
  createGenerateImageToolDefinition,
  type GenerateImageOperations,
} from "../src/core/tools/generate-image.ts";

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
          { type: "image", mimeType: "image/png", data: "aGVsbG8td29ybGQ=" },
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
    id: "dall-e-3",
    name: "DALL-E 3",
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
      writeFile: async (filePath, buffer) => {
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

    const tool = createGenerateImageTool("/workspace", {
      model: dummyModel,
      apiKey: "test-api-key",
      operations: mockOperations,
    });

    const result = await tool.execute("call-1", {
      prompt: "A beautiful forest",
      outputPath: "assets/forest.png",
      aspectRatio: "16:9",
    });

    expect(result.content[0].type).toBe("text");
    expect((result.content[0] as { text: string }).text).toContain("Successfully generated image");
    expect(result.details?.outputPath).toBe("assets/forest.png");
    expect(result.details?.bytes).toBe(Buffer.from("aGVsbG8td29ybGQ=", "base64").length);
    expect(result.details?.revisedPrompt).toBe("Revised: a red circle");
    expect(result.details?.provider).toBe("openai");
    expect(result.details?.model).toBe("dall-e-3");

    expect(createdDirs.has("/workspace/assets")).toBe(true);
    expect(writtenFiles.has("/workspace/assets/forest.png")).toBe(true);

    // Assert strict write→rename ordering
    const writeIdx = operationsLog.findIndex((op) => op.startsWith("write:/workspace/assets/forest.png.tmp"));
    const renameIdx = operationsLog.findIndex((op) => op.startsWith("rename:/workspace/assets/forest.png.tmp"));
    expect(writeIdx).toBeGreaterThanOrEqual(0);
    expect(renameIdx).toBeGreaterThanOrEqual(0);
    expect(writeIdx).toBeLessThan(renameIdx);
  });

  it("auto-generates unique collision-safe output path if omitted", async () => {
    const writtenFiles = new Map<string, Buffer>();

    const mockOperations: GenerateImageOperations = {
      writeFile: async (filePath, buffer) => {
        writtenFiles.set(filePath, buffer);
      },
      rename: async (oldPath, newPath) => {
        const data = writtenFiles.get(oldPath);
        if (data) {
          writtenFiles.set(newPath, data);
          writtenFiles.delete(oldPath);
        }
      },
      unlink: async () => {},
      mkdir: async () => {},
    };

    const tool = createGenerateImageTool("/workspace", {
      resolveModel: async () => ({ model: dummyModel, apiKey: "dynamic-key" }),
      operations: mockOperations,
    });

    const result = await tool.execute("call-2", {
      prompt: "A cat sleeping",
    });

    expect(result.details?.outputPath).toMatch(/^assets\/generated_\d+_[a-z0-9]+\.png$/);
    const writtenPaths = Array.from(writtenFiles.keys());
    expect(writtenPaths.length).toBe(1);
    expect(writtenPaths[0]).toMatch(/\/workspace\/assets\/generated_\d+_[a-z0-9]+\.png$/);
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

  it("throws error on conflicting size and aspectRatio", async () => {
    const tool = createGenerateImageTool("/workspace", {
      model: dummyModel,
      apiKey: "test-api-key",
    });

    await expect(
      tool.execute("call-conflict", { prompt: "Test", size: "1792x1024", aspectRatio: "9:16" }),
    ).rejects.toThrow("Conflicting size");
  });

  it("aborts and cleans up temp file when signal fires during write", async () => {
    const controller = new AbortController();
    const unlinkedPaths: string[] = [];

    const mockOperations: GenerateImageOperations = {
      writeFile: async () => {
        // Abort during write
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

  it("renders call and result properly", () => {
    const toolDef = createGenerateImageToolDefinition("/workspace", { model: dummyModel });
    const fakeTheme = {
      fg: (_color: string, text: string) => text,
    };

    const callComponent = toolDef.renderCall!(
      { prompt: "A dog", outputPath: "dog.png" },
      fakeTheme as any,
      { cwd: "/workspace", expanded: false, isPartial: false, argsComplete: true } as any,
    );
    expect((callComponent as any).text).toContain("generate_image");
    expect((callComponent as any).text).toContain("dog.png");

    const errorResultComponent = toolDef.renderResult!(
      {
        content: [{ type: "text", text: "Something went wrong" }],
        details: { outputPath: "dog.png", bytes: 0, mimeType: "image/png", prompt: "A dog" },
      },
      {} as any,
      fakeTheme as any,
      { isError: true, showHarnessMessages: true } as any,
    );
    expect((errorResultComponent as any).text).toContain("Something went wrong");
  });
});
