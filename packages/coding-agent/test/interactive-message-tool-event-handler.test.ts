import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionEvent } from "../src/core/agent-session.ts";
import { SLEEP_TOOL_NAME } from "../src/core/messages.ts";
import type { InteractiveMode } from "../src/modes/interactive/interactive-mode/interactivemode.ts";

interface AssistantDouble {
  updateContent: Mock;
}

interface ToolDouble {
  markExecutionStarted: Mock;
  setArgsComplete: Mock;
  setExpanded: Mock;
  updateArgs: Mock;
  updateResult: Mock;
}

const componentDoubles = vi.hoisted(() => ({
  assistants: [] as AssistantDouble[],
  tools: [] as ToolDouble[],
}));

vi.mock("../src/modes/interactive/components/assistant-message.ts", () => ({
  AssistantMessageComponent: vi.fn(function AssistantMessageComponent() {
    const instance = { updateContent: vi.fn() };
    componentDoubles.assistants.push(instance);
    return instance;
  }),
}));

vi.mock("../src/modes/interactive/components/tool-execution.ts", () => ({
  ToolExecutionComponent: vi.fn(function ToolExecutionComponent() {
    const instance = {
      markExecutionStarted: vi.fn(),
      setArgsComplete: vi.fn(),
      setExpanded: vi.fn(),
      updateArgs: vi.fn(),
      updateResult: vi.fn(),
    };
    componentDoubles.tools.push(instance);
    return instance;
  }),
}));

import { handleMessageEvent } from "../src/modes/interactive/interactive-mode/interactivemode-methods/message-event-handler.ts";
import { handleToolEvent } from "../src/modes/interactive/interactive-mode/interactivemode-methods/tool-event-handler.ts";

function event(value: object): AgentSessionEvent {
  return value as AgentSessionEvent;
}

function createMode() {
  const footerDataProvider = {
    clearProgress: vi.fn(),
    getQueuedProgress: vi.fn(() => undefined as { source: string } | undefined),
    setGenProgress: vi.fn(),
    setLoadingProgress: vi.fn(),
    setModelSwitchProgress: vi.fn(),
    setPrefillProgress: vi.fn(),
    setQueuedProgress: vi.fn(),
    setSendingProgress: vi.fn(),
  };
  return {
    addMessageToChat: vi.fn(),
    chatContainer: { addChild: vi.fn() },
    clearLlmOrchestratorQueueProgress: vi.fn(),
    footer: { invalidate: vi.fn() },
    footerDataProvider,
    getMarkdownThemeWithSettings: vi.fn(() => ({})),
    getModelStatusLabel: vi.fn(() => "model"),
    getRecentModelSwitch: vi.fn(() => undefined as object | undefined),
    getRegisteredToolDefinition: vi.fn(() => undefined),
    hiddenThinkingLabel: "thinking",
    hideThinkingBlock: false,
    pendingTools: new Map<string, ToolDouble>(),
    planStatusTracker: { addToolEvent: vi.fn(), updateToolEvent: vi.fn() },
    removeTransientStreamingUi: vi.fn(),
    session: { retryAttempt: 0, willRetryMessage: vi.fn(() => false) },
    sessionManager: { getCwd: vi.fn(() => "/tmp") },
    settingsManager: {
      getImageWidthCells: vi.fn(() => 40),
      getShowHarnessMessages: vi.fn(() => true),
      getShowImages: vi.fn(() => true),
    },
    streamingComponent: undefined as AssistantDouble | undefined,
    streamingMessage: undefined as Record<string, unknown> | undefined,
    syncPlanTracker: vi.fn(),
    toolOutputExpanded: true,
    ui: { requestRender: vi.fn() },
    updatePendingMessagesDisplay: vi.fn(),
  };
}

function message(mode: ReturnType<typeof createMode>, value: object) {
  return handleMessageEvent(mode as unknown as InteractiveMode, event(value));
}

function tool(mode: ReturnType<typeof createMode>, value: object) {
  return handleToolEvent(mode as unknown as InteractiveMode, event(value));
}

beforeEach(() => {
  componentDoubles.assistants.length = 0;
  componentDoubles.tools.length = 0;
});

describe("interactive message event handler", () => {
  it("tracks request, message start, and every streaming progress kind", () => {
    const mode = createMode();
    mode.getRecentModelSwitch.mockReturnValue({ fromModel: "old", toModel: "new" });
    expect(message(mode, { type: "request_start", model: "test" })).toBe(true);
    expect(mode.footerDataProvider.setModelSwitchProgress).toHaveBeenCalled();
    expect(mode.footerDataProvider.setSendingProgress).toHaveBeenCalledWith({ model: "model" });

    mode.footerDataProvider.getQueuedProgress.mockReturnValue({ source: "llm-orchestrator" });
    message(mode, { type: "request_start", model: "test" });
    expect(mode.footerDataProvider.clearProgress).toHaveBeenLastCalledWith({ preserveQueued: true });

    const custom = { role: "custom", customType: "notice", content: "hello", display: true };
    const user = { role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 };
    const assistant = { role: "assistant", content: [], timestamp: 2 };
    message(mode, { type: "message_start", message: custom });
    message(mode, { type: "message_start", message: user });
    message(mode, { type: "message_start", message: assistant });
    expect(mode.addMessageToChat).toHaveBeenCalledTimes(2);
    expect(mode.updatePendingMessagesDisplay).toHaveBeenCalled();
    expect(componentDoubles.assistants).toHaveLength(1);

    const updates = [
      {
        type: "queue_progress",
        position: 2,
        queuedAhead: 1,
        queue: "q",
        workerId: "w",
        ticketId: "t",
        queuedAtMs: 3,
        queuedForMs: 4,
      },
      { type: "prefill_progress", elapsedMs: 5, percent: 50, tokensPerSecond: 6 },
      { type: "prefill_progress", elapsedMs: 7 },
      { type: "gen_progress", tokensPerSecond: 8, tokens: 9 },
      { type: "model_switch_progress", fromModel: "a", toModel: "b" },
      { type: "loading_progress", model: "b" },
      { type: "text_start" },
      { type: "thinking_start" },
      { type: "toolcall_start" },
    ];
    for (const assistantMessageEvent of updates) {
      message(mode, {
        type: "message_update",
        message: { ...assistant, content: [] },
        assistantMessageEvent,
      });
    }
    expect(mode.footerDataProvider.setQueuedProgress).toHaveBeenCalledWith(
      expect.objectContaining({ source: "llm-orchestrator" }),
    );
    expect(mode.footerDataProvider.setPrefillProgress).toHaveBeenCalledWith({
      elapsedMs: 7,
      percent: 100,
      tokensPerSecond: undefined,
    });
    expect(mode.footerDataProvider.setGenProgress).toHaveBeenCalledWith({ tokensPerSecond: 8, tokens: 9 });
    expect(mode.footerDataProvider.setLoadingProgress).toHaveBeenCalledWith({ model: "b" });
    expect(message(mode, { type: "unknown" })).toBe(false);
  });

  it("creates and updates tool components embedded in assistant messages", () => {
    const mode = createMode();
    const assistant = { role: "assistant", content: [], timestamp: 1 };
    message(mode, { type: "message_start", message: assistant });
    const content = [
      { type: "toolCall", id: "new", name: "bash", arguments: { command: "pwd" } },
      { type: "toolCall", id: "sleep", name: SLEEP_TOOL_NAME, arguments: {} },
    ];
    message(mode, { type: "message_update", message: { ...assistant, content } });
    expect(componentDoubles.tools).toHaveLength(1);
    expect(componentDoubles.tools[0]?.setExpanded).toHaveBeenCalledWith(true);
    message(mode, { type: "message_update", message: { ...assistant, content } });
    expect(componentDoubles.tools[0]?.updateArgs).toHaveBeenCalledWith({ command: "pwd" });
  });

  it("finalizes success, abort, terminal error, and retryable error", () => {
    const successMode = createMode();
    message(successMode, { type: "message_start", message: { role: "assistant", content: [], timestamp: 1 } });
    const completedTool = componentDoubles.tools[0] ?? {
      markExecutionStarted: vi.fn(),
      setArgsComplete: vi.fn(),
      setExpanded: vi.fn(),
      updateArgs: vi.fn(),
      updateResult: vi.fn(),
    };
    successMode.pendingTools.set("done", completedTool);
    message(successMode, {
      type: "message_end",
      message: { role: "assistant", content: [], stopReason: "stop", timestamp: 1 },
    });
    expect(completedTool.setArgsComplete).toHaveBeenCalled();

    const abortMode = createMode();
    message(abortMode, { type: "message_start", message: { role: "assistant", content: [], timestamp: 1 } });
    const abortedTool = { ...completedTool, updateResult: vi.fn() };
    abortMode.pendingTools.set("aborted", abortedTool);
    abortMode.session.retryAttempt = 2;
    message(abortMode, {
      type: "message_end",
      message: { role: "assistant", content: [], stopReason: "aborted", timestamp: 1 },
    });
    expect(abortedTool.updateResult).toHaveBeenCalledWith(expect.objectContaining({ isError: true }));

    const errorMode = createMode();
    message(errorMode, { type: "message_start", message: { role: "assistant", content: [], timestamp: 1 } });
    const failedTool = { ...completedTool, updateResult: vi.fn() };
    errorMode.pendingTools.set("failed", failedTool);
    message(errorMode, {
      type: "message_end",
      message: { role: "assistant", content: [], stopReason: "error", errorMessage: "boom", timestamp: 1 },
    });
    expect(failedTool.updateResult).toHaveBeenCalledWith(expect.objectContaining({ isError: true }));

    const retryMode = createMode();
    message(retryMode, { type: "message_start", message: { role: "assistant", content: [], timestamp: 1 } });
    retryMode.session.willRetryMessage.mockReturnValue(true);
    message(retryMode, {
      type: "message_end",
      message: { role: "assistant", content: [], stopReason: "error", timestamp: 1 },
    });
    expect(retryMode.removeTransientStreamingUi).toHaveBeenCalled();
    expect(message(retryMode, { type: "message_end", message: { role: "user", content: [], timestamp: 1 } })).toBe(
      true,
    );
  });
});

describe("interactive tool event handler", () => {
  it("handles tool start, updates, completion, sleep, and unknown events", () => {
    const mode = createMode();
    expect(
      tool(mode, { type: "tool_execution_start", toolCallId: "one", toolName: "bash", args: { command: "pwd" } }),
    ).toBe(true);
    const component = componentDoubles.tools[0];
    expect(component?.markExecutionStarted).toHaveBeenCalled();
    tool(mode, { type: "tool_execution_update", toolCallId: "one", toolName: "bash", partialResult: { content: [] } });
    expect(component?.updateResult).toHaveBeenCalledWith({ content: [], isError: false }, true);
    tool(mode, {
      type: "tool_execution_end",
      toolCallId: "one",
      toolName: "bash",
      result: { content: [] },
      isError: true,
    });
    expect(mode.planStatusTracker.updateToolEvent).toHaveBeenCalledWith("one", { status: "error" });
    expect(mode.pendingTools.has("one")).toBe(false);

    mode.pendingTools.set("existing", component as ToolDouble);
    tool(mode, { type: "tool_execution_start", toolCallId: "existing", toolName: "read", args: {} });
    mode.pendingTools.set("sleep", component as ToolDouble);
    tool(mode, { type: "tool_execution_start", toolCallId: "sleep", toolName: SLEEP_TOOL_NAME, args: {} });
    tool(mode, {
      type: "tool_execution_end",
      toolCallId: "sleep",
      toolName: SLEEP_TOOL_NAME,
      result: { content: [] },
      isError: false,
    });
    tool(mode, {
      type: "tool_execution_update",
      toolCallId: "missing",
      toolName: "read",
      partialResult: { content: [] },
    });
    tool(mode, {
      type: "tool_execution_end",
      toolCallId: "missing",
      toolName: "read",
      result: { content: [] },
      isError: false,
    });
    expect(mode.pendingTools.has("sleep")).toBe(false);
    expect(tool(mode, { type: "unknown" })).toBe(false);
  });
});
