import type { AgentMessage } from "@dst0/p-agent-core";
import { describe, expect, it } from "vitest";
import { convertSdkMessages } from "../src/core/sdk-message-conversion.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

describe("SDK image policy conversion", () => {
  it("leaves tool and text-only messages intact when image reading is disabled", () => {
    const messages = [
      { role: "user", content: "Preserve the text prompt", timestamp: 0 },
      {
        role: "toolResult",
        toolCallId: "read-1",
        toolName: "read",
        content: [{ type: "text", text: "File content" }],
        isError: false,
        timestamp: 0,
      },
    ] satisfies AgentMessage[];
    expect(convertSdkMessages(messages, SettingsManager.inMemory({ images: { blockImages: true } }))).toEqual(messages);
  });
  it("uses current settings and preserves unrelated text while replacing adjacent images once", () => {
    const settings = SettingsManager.inMemory({ images: { blockImages: false } });
    const messages = [
      {
        role: "user",
        timestamp: 0,
        content: [
          { type: "text", text: "Inspect the attachments" },
          { type: "image", data: "fixture", mimeType: "image/png" },
          { type: "image", data: "fixture", mimeType: "image/png" },
          { type: "text", text: "Preserve this explanation" },
        ],
      },
    ] satisfies AgentMessage[];
    expect(convertSdkMessages(messages, settings)[0].content).toEqual(messages[0].content);
    settings.setBlockImages(true);
    expect(convertSdkMessages(messages, settings)[0].content).toEqual([
      { type: "text", text: "Inspect the attachments" },
      { type: "text", text: "Image reading is disabled." },
      { type: "text", text: "Preserve this explanation" },
    ]);
    expect(messages[0].content).toHaveLength(4);
  });
});
