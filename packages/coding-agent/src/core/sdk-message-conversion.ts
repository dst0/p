import type { AgentMessage } from "@dst0/p-agent-core";
import type { Message } from "@dst0/p-ai";
import { convertToLlm } from "./messages.ts";
import type { SettingsManager } from "./settings-manager.ts";

/** Resolve image policy dynamically, including changes during an existing session. */
export function convertSdkMessages(messages: AgentMessage[], settingsManager: SettingsManager): Message[] {
  const converted = convertToLlm(messages);
  if (!settingsManager.getBlockImages()) return converted;
  return converted.map((msg) => {
    if (msg.role === "user" || msg.role === "toolResult") {
      const content = msg.content;
      if (Array.isArray(content) && content.some((item) => item.type === "image")) {
        const filteredContent = content
          .map((item) => (item.type === "image" ? { type: "text" as const, text: "Image reading is disabled." } : item))
          .filter(
            (item, index, items) =>
              !(
                item.type === "text" &&
                item.text === "Image reading is disabled." &&
                index > 0 &&
                items[index - 1].type === "text" &&
                (items[index - 1] as { type: "text"; text: string }).text === "Image reading is disabled."
              ),
          );
        return { ...msg, content: filteredContent };
      }
    }
    return msg;
  });
}
