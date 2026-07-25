import { describe, expect, it } from "vitest";
import { transformMessages } from "../src/providers/transform-messages.ts";
import type { Api, Message, Model } from "../src/types.ts";

describe("transform-messages-unit", () => {
  it("replaces consecutive images with a single placeholder for non-vision model", () => {
    const nonVisionModel: Model<Api> = {
      id: "text-only-model",
      provider: "test",
      api: "test-api" as Api,
      input: ["text"],
    } as any;

    const messages: Message[] = [
      {
        role: "user",
        content: [
          { type: "image", mimeType: "image/png", data: "1" },
          { type: "image", mimeType: "image/png", data: "2" },
          { type: "text", text: "hello" },
        ],
        timestamp: 0,
      },
      {
        role: "toolResult",
        toolCallId: "call_1",
        toolName: "fn",
        content: [
          { type: "image", mimeType: "image/png", data: "3" },
          { type: "image", mimeType: "image/png", data: "4" },
        ],
        isError: false,
        timestamp: 0,
      },
    ];

    const result = transformMessages(messages, nonVisionModel);
    expect(result[0].role).toBe("user");
    if (result[0].role === "user" && Array.isArray(result[0].content)) {
      expect(result[0].content).toHaveLength(2); // 1 placeholder + 1 text
      expect(result[0].content[0]).toEqual({
        type: "text",
        text: "(image omitted: model does not support images)",
      });
    }

    if (result[1].role === "toolResult") {
      expect(result[1].content).toHaveLength(1);
      expect(result[1].content[0]).toEqual({
        type: "text",
        text: "(tool image omitted: model does not support images)",
      });
    }
  });

  it("handles unknown message role in second pass", () => {
    const model: Model<Api> = {
      id: "m",
      provider: "p",
      api: "a" as Api,
      input: ["text"],
    } as any;

    const customMsg = { role: "system", content: "sys" } as unknown as Message;
    const res = transformMessages([customMsg], model);
    expect(res[0]).toBe(customMsg);
  });
});
