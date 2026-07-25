import { describe, expect, it } from "vitest";
import {
  buildCopilotDynamicHeaders,
  hasCopilotVisionInput,
  inferCopilotInitiator,
} from "../src/providers/github-copilot-headers.ts";
import type { Message } from "../src/types.ts";

describe("github-copilot-headers", () => {
  it("infers Copilot initiator", () => {
    const emptyMsgs: Message[] = [];
    expect(inferCopilotInitiator(emptyMsgs)).toBe("user");

    const userMsgs: Message[] = [{ role: "user", content: "hello", timestamp: 0 }];
    expect(inferCopilotInitiator(userMsgs)).toBe("user");

    const toolResultMsgs: Message[] = [
      { role: "user", content: "hello", timestamp: 0 },
      {
        role: "toolResult",
        toolCallId: "1",
        toolName: "t",
        content: [{ type: "text", text: "res" }],
        isError: false,
        timestamp: 0,
      },
    ];
    expect(inferCopilotInitiator(toolResultMsgs)).toBe("agent");
  });

  it("detects vision input in user and toolResult messages", () => {
    const textMsg: Message = { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 0 };
    expect(hasCopilotVisionInput([textMsg])).toBe(false);

    const userVisionMsg: Message = {
      role: "user",
      content: [{ type: "image", mimeType: "image/png", data: "base64" }],
      timestamp: 0,
    };
    expect(hasCopilotVisionInput([userVisionMsg])).toBe(true);

    const toolResultVisionMsg: Message = {
      role: "toolResult",
      toolCallId: "1",
      toolName: "t",
      content: [{ type: "image", mimeType: "image/png", data: "base64" }],
      isError: false,
      timestamp: 0,
    };
    expect(hasCopilotVisionInput([toolResultVisionMsg])).toBe(true);
  });

  it("builds Copilot dynamic headers", () => {
    const messages: Message[] = [{ role: "user", content: "hello", timestamp: 0 }];

    const headersWithoutImages = buildCopilotDynamicHeaders({ messages, hasImages: false });
    expect(headersWithoutImages).toEqual({
      "X-Initiator": "user",
      "Openai-Intent": "conversation-edits",
    });

    const headersWithImages = buildCopilotDynamicHeaders({ messages, hasImages: true });
    expect(headersWithImages).toEqual({
      "X-Initiator": "user",
      "Openai-Intent": "conversation-edits",
      "Copilot-Vision-Request": "true",
    });
  });
});
