import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ImagesModel } from "@dst0/p-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAllToolDefinitions,
  createAllTools,
  createCodingToolDefinitions,
  createCodingTools,
  createTool,
  createToolDefinition,
  type GenerateImageOperations,
} from "../src/core/tools/index.ts";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

vi.mock("@dst0/p-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dst0/p-ai")>();
  return {
    ...actual,
    generateImages: vi.fn(async (model: ImagesModel<"openai-images">) => ({
      api: model.api,
      provider: model.provider,
      model: model.id,
      output: [{ type: "image" as const, mimeType: "image/png", data: PNG_BASE64 }],
      stopReason: "stop" as const,
      timestamp: Date.now(),
    })),
  };
});

describe("generate_image factory integration", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it("propagates lazy model resolution and file operations through every image factory surface", async () => {
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
    const resolveModel = vi.fn(async () => ({ model, headers: { "x-image-client": "factory-test" } }));
    const operations: GenerateImageOperations = {
      writeFile: vi.fn(async () => {}),
      rename: vi.fn(async () => {}),
      unlink: vi.fn(async () => {}),
      mkdir: vi.fn(async () => {}),
    };
    const options = { generateImage: { resolveModel, operations } };
    const cwd = await mkdtemp(join(tmpdir(), "p-generate-image-factories-"));
    temporaryDirectories.push(cwd);
    const definitions = [
      createToolDefinition("generate_image", cwd, options),
      createCodingToolDefinitions(cwd, options).find((tool) => tool.name === "generate_image"),
      createAllToolDefinitions(cwd, options).generate_image,
    ];
    const runtimeTools = [
      createTool("generate_image", cwd, options),
      createCodingTools(cwd, options).find((tool) => tool.name === "generate_image"),
      createAllTools(cwd, options).generate_image,
    ];

    for (const [index, definition] of definitions.entries()) {
      expect(definition).toBeDefined();
      const result = await definition?.execute(
        `definition-${index}`,
        { prompt: "draw a factory", outputPath: `definition-${index}.png` },
        undefined,
        undefined,
        {} as never,
      );
      expect(result?.details?.provider).toBe("llm-orchestrator");
    }
    for (const [index, tool] of runtimeTools.entries()) {
      expect(tool).toBeDefined();
      const result = await tool?.execute(`runtime-${index}`, {
        prompt: "draw a factory",
        outputPath: `runtime-${index}.png`,
      });
      expect(result?.details?.provider).toBe("llm-orchestrator");
    }

    expect(resolveModel).toHaveBeenCalledTimes(6);
    expect(operations.writeFile).toHaveBeenCalledTimes(6);
    expect(operations.rename).toHaveBeenCalledTimes(6);
  });
});
