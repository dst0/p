import type { ImagesModel } from "@dst0/p-ai";
import { Container, Text } from "@dst0/p-tui";
import { describe, expect, it } from "vitest";
import { createGenerateImageToolDefinition } from "../src/core/tools/generate-image.ts";

describe("generate_image rendering", () => {
  it("renders the prompt, target, and provider error", () => {
    const model: ImagesModel<"openai-images"> = {
      id: "gpt-image-2",
      name: "GPT Image 2",
      api: "openai-images",
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      input: ["text"],
      output: ["image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
    const toolDefinition = createGenerateImageToolDefinition("/workspace", { model });
    const theme = { fg: (_color: string, text: string) => text };

    const callComponent = toolDefinition.renderCall!(
      { prompt: "A dog", outputPath: "dog.png" },
      theme as never,
      { cwd: "/workspace", expanded: false, isPartial: false, argsComplete: true } as never,
    );
    expect((callComponent as unknown as { text: string }).text).toContain("generate_image");
    expect((callComponent as unknown as { text: string }).text).toContain("dog.png");

    const errorComponent = toolDefinition.renderResult!(
      {
        content: [{ type: "text", text: "Something went wrong" }],
        details: { outputPath: "dog.png", bytes: 0, mimeType: "image/png", prompt: "A dog" },
      },
      {} as never,
      theme as never,
      { isError: true, showHarnessMessages: true } as never,
    );
    expect((errorComponent as unknown as { text: string }).text).toContain("Something went wrong");

    const sanitizedError = toolDefinition.renderResult!(
      {
        content: [{ type: "text", text: "Verification evidence handle: internal\nVisible failure" }],
        details: { outputPath: "dog.png", bytes: 0, mimeType: "image/png", prompt: "A dog" },
      },
      {} as never,
      theme as never,
      { isError: true, showHarnessMessages: false } as never,
    );
    expect((sanitizedError as unknown as { text: string }).text).toContain("Visible failure");
    expect((sanitizedError as unknown as { text: string }).text).not.toContain("evidence handle");

    const previousComponent = new Container();
    previousComponent.addChild(new Text("stale", 0, 0));
    const success = toolDefinition.renderResult!(
      {
        content: [{ type: "text", text: "saved" }],
        details: { outputPath: "dog.png", bytes: 1, mimeType: "image/png", prompt: "A dog" },
      },
      {} as never,
      theme as never,
      { isError: false, lastComponent: previousComponent } as never,
    );
    expect(success).toBe(previousComponent);
    expect(previousComponent.children).toHaveLength(0);
  });
});
