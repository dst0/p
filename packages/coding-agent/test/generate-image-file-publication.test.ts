import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ImagesApi, ImagesModel } from "@dst0/p-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGenerateImageTool } from "../src/core/tools/generate-image.ts";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

vi.mock("@dst0/p-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dst0/p-ai")>();
  return {
    ...actual,
    generateImages: vi.fn(async (model: ImagesModel<ImagesApi>) => ({
      api: model.api,
      provider: model.provider,
      model: model.id,
      output: [{ type: "image" as const, mimeType: "image/png", data: PNG_BASE64 }],
      stopReason: "stop" as const,
      timestamp: Date.now(),
    })),
  };
});

describe("generate_image file publication", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it("publishes a complete image through the real filesystem without leaving a temporary file", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "p-generate-image-"));
    temporaryDirectories.push(cwd);
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
    const tool = createGenerateImageTool(cwd, { model });

    const result = await tool.execute("file-publication", {
      prompt: "A brass compass",
      outputPath: "assets/compass.png",
      size: "1234x567",
    });

    expect(await readFile(join(cwd, "assets/compass.png"))).toEqual(Buffer.from(PNG_BASE64, "base64"));
    expect(await readdir(join(cwd, "assets"))).toEqual(["compass.png"]);
    expect(result.details?.outputPath).toBe("assets/compass.png");
  });

  it("atomically replaces an existing target without leaving a temporary file", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "p-generate-image-replace-"));
    temporaryDirectories.push(cwd);
    await mkdir(join(cwd, "assets"));
    await writeFile(join(cwd, "assets/compass.png"), "old image");
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

    const tool = createGenerateImageTool(cwd, { model });
    await tool.execute("file-replacement", {
      prompt: "A brass compass",
      outputPath: "assets/compass.png",
    });

    expect(await readFile(join(cwd, "assets/compass.png"))).toEqual(Buffer.from(PNG_BASE64, "base64"));
    expect(await readdir(join(cwd, "assets"))).toEqual(["compass.png"]);
  });

  it("publishes distinct collision-resistant paths for consecutive generated images", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "p-generate-image-paths-"));
    temporaryDirectories.push(cwd);
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
    const tool = createGenerateImageTool(cwd, { model });

    const first = await tool.execute("file-path-one", { prompt: "A sleeping cat" });
    const second = await tool.execute("file-path-two", { prompt: "A waking cat" });
    const published = await readdir(join(cwd, "assets"));

    expect(first.details?.outputPath).toMatch(/^assets\/generated_\d+_[a-z0-9]+\.png$/);
    expect(second.details?.outputPath).toMatch(/^assets\/generated_\d+_[a-z0-9]+\.png$/);
    expect(second.details?.outputPath).not.toBe(first.details?.outputPath);
    expect(published).toHaveLength(2);
    expect(new Set(published).size).toBe(2);
  });
});
