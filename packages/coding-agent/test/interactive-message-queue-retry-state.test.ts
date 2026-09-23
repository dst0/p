import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionEvent } from "../src/core/agent-session.ts";
import { FooterDataProvider } from "../src/core/footer-data-provider.ts";
import { SLEEP_TOOL_NAME } from "../src/core/messages.ts";
import type { InteractiveMode } from "../src/modes/interactive/interactive-mode/interactivemode.ts";

vi.mock("../src/modes/interactive/components/assistant-message.ts", () => ({
  AssistantMessageComponent: vi.fn(function AssistantMessageComponent() {
    return { updateContent: vi.fn() };
  }),
}));

import { handleMessageEvent } from "../src/modes/interactive/interactive-mode/interactivemode-methods/message-event-handler.ts";

const tempDirectories: string[] = [];

function event(value: object): AgentSessionEvent {
  return value as AgentSessionEvent;
}

function message(mode: object, value: object): boolean {
  return handleMessageEvent(mode as InteractiveMode, event(value));
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("interactive orchestrator queue retry state", () => {
  it("preserves queue and switch through sleep retry until real prefill begins", () => {
    const directory = mkdtempSync(join(tmpdir(), "interactive-queue-retry-"));
    tempDirectories.push(directory);
    const footerDataProvider = new FooterDataProvider(directory);
    const streamingComponent = { updateContent: vi.fn() };
    const mode = {
      addMessageToChat: vi.fn(),
      chatContainer: { addChild: vi.fn() },
      clearLlmOrchestratorQueueProgress: () => {
        if (footerDataProvider.getQueuedProgress()?.source === "llm-orchestrator") {
          footerDataProvider.setQueuedProgress(undefined);
        }
      },
      footer: { invalidate: vi.fn() },
      footerDataProvider,
      getMarkdownThemeWithSettings: vi.fn(() => ({})),
      getModelStatusLabel: vi.fn(() => "new/model"),
      getRecentModelSwitch: vi.fn(() => undefined),
      hiddenThinkingLabel: "thinking",
      hideThinkingBlock: false,
      pendingTools: new Map(),
      removeTransientStreamingUi: vi.fn(),
      session: { retryAttempt: 0, willRetryMessage: vi.fn(() => false) },
      streamingComponent,
      streamingMessage: undefined,
      syncPlanTracker: vi.fn(),
      ui: { requestRender: vi.fn() },
      updatePendingMessagesDisplay: vi.fn(),
    };

    try {
      footerDataProvider.setModelSwitchProgress({ fromModel: "old/model", toModel: "new/model" });
      footerDataProvider.setQueuedProgress({
        position: 1,
        queuedAhead: 0,
        queue: "model",
        ticketId: "retry-ticket",
        source: "llm-orchestrator",
      });

      message(mode, {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "sleep", name: SLEEP_TOOL_NAME, arguments: {} }],
          stopReason: "toolUse",
          timestamp: 1,
        },
      });
      message(mode, { type: "request_start", model: { provider: "test", id: "model" } });
      message(mode, { type: "message_start", message: { role: "assistant", content: [], timestamp: 2 } });

      expect(footerDataProvider.getQueuedProgress()).toMatchObject({ ticketId: "retry-ticket" });
      expect(footerDataProvider.getModelSwitchProgress()).toEqual({
        fromModel: "old/model",
        toModel: "new/model",
      });
      expect(footerDataProvider.getPrefillProgress()).toBeUndefined();

      message(mode, {
        type: "message_update",
        message: { role: "assistant", content: [], timestamp: 2 },
        assistantMessageEvent: { type: "prefill_progress", elapsedMs: 25, percent: 10 },
      });

      expect(footerDataProvider.getQueuedProgress()).toBeUndefined();
      expect(footerDataProvider.getModelSwitchProgress()).toBeUndefined();
      expect(footerDataProvider.getPrefillProgress()).toEqual({
        elapsedMs: 25,
        percent: 10,
        tokensPerSecond: undefined,
      });
    } finally {
      footerDataProvider.dispose();
    }
  });
});
