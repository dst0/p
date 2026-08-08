import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentSessionEvent } from "../src/core/agent-session.ts";
import type { InteractiveMode } from "../src/modes/interactive/interactive-mode/interactivemode.ts";
import { handleLifecycleEvent } from "../src/modes/interactive/interactive-mode/interactivemode-methods/lifecycle-event-handler.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

function event(value: object): AgentSessionEvent {
  return value as AgentSessionEvent;
}

function createMode() {
  const oldEscape = vi.fn();
  const mode = {
    pendingTools: new Map([["tool", {}]]),
    footerDataProvider: { clearProgress: vi.fn() },
    settingsManager: { getShowTerminalProgress: vi.fn(() => true) },
    ui: {
      requestRender: vi.fn(),
      terminal: { setProgress: vi.fn() },
    },
    defaultEditor: { onEscape: oldEscape },
    retryEscapeHandler: undefined as (() => void) | undefined,
    retryCountdown: undefined as { dispose: () => void } | undefined,
    retryLoader: undefined as { stop: () => void; setMessage: (message: string) => void } | undefined,
    autoCompactionEscapeHandler: undefined as (() => void) | undefined,
    autoCompactionLoader: undefined as { stop: () => void; setMessage: (message: string) => void } | undefined,
    loadingAnimation: undefined as { stop: () => void } | undefined,
    streamingComponent: undefined as object | undefined,
    streamingMessage: undefined as object | undefined,
    workingVisible: true,
    stopWorkingLoader: vi.fn(),
    createWorkingLoader: vi.fn(() => ({ stop: vi.fn() })),
    statusContainer: { addChild: vi.fn(), clear: vi.fn() },
    chatContainer: { addChild: vi.fn(), removeChild: vi.fn(), clear: vi.fn() },
    updatePendingMessagesDisplay: vi.fn(),
    updateTerminalTitle: vi.fn(),
    updateEditorBorderColor: vi.fn(),
    footer: { invalidate: vi.fn() },
    checkShutdownRequested: vi.fn(async () => undefined),
    session: { abortCompaction: vi.fn(), abortRetry: vi.fn() },
    showError: vi.fn(),
    showStatus: vi.fn(),
    rebuildChatFromMessages: vi.fn(),
    flushCompactionQueue: vi.fn(async () => undefined),
    showRetryProgressInFooter: vi.fn(),
    getRecentModelSwitch: vi.fn((): { fromModel: string; toModel: string } | undefined => undefined),
  };
  return { mode, oldEscape };
}

function handle(mode: ReturnType<typeof createMode>["mode"], value: object) {
  return handleLifecycleEvent(mode as unknown as InteractiveMode, event(value));
}

afterEach(() => {
  vi.useRealTimers();
});

beforeAll(() => {
  initTheme("dark");
});

describe("interactive lifecycle event handler", () => {
  it("handles agent and session lifecycle updates", async () => {
    const { mode, oldEscape } = createMode();
    const retryDispose = vi.fn();
    const retryStop = vi.fn();
    mode.retryEscapeHandler = oldEscape;
    mode.retryCountdown = { dispose: retryDispose };
    mode.retryLoader = { stop: retryStop, setMessage: vi.fn() };

    await expect(handle(mode, { type: "agent_start" })).resolves.toBe(true);
    expect(mode.pendingTools.size).toBe(0);
    expect(retryDispose).toHaveBeenCalled();
    expect(retryStop).toHaveBeenCalled();
    expect(mode.defaultEditor.onEscape).toBe(oldEscape);
    expect(mode.statusContainer.addChild).toHaveBeenCalled();

    await handle(mode, { type: "queue_update", steering: [], followUp: [] });
    await handle(mode, { type: "session_info_changed", name: "session" });
    await handle(mode, { type: "thinking_level_changed", level: "high" });
    await handle(mode, { type: "interaction_mode_changed", mode: "plan" });
    expect(mode.updatePendingMessagesDisplay).toHaveBeenCalled();
    expect(mode.updateTerminalTitle).toHaveBeenCalled();
    expect(mode.updateEditorBorderColor).toHaveBeenCalled();

    const animationStop = vi.fn();
    const streaming = {};
    mode.loadingAnimation = { stop: animationStop };
    mode.streamingComponent = streaming;
    mode.streamingMessage = {};
    mode.pendingTools.set("tool", {});
    await handle(mode, { type: "agent_end", messages: [], willRetry: false });
    expect(animationStop).toHaveBeenCalled();
    expect(mode.chatContainer.removeChild).toHaveBeenCalledWith(streaming);
    expect(mode.checkShutdownRequested).toHaveBeenCalled();
    expect(mode.ui.terminal.setProgress).toHaveBeenLastCalledWith(false);

    await expect(handle(mode, { type: "unknown" })).resolves.toBe(false);
  });

  it("handles compaction progress, cancellation, success, and errors", async () => {
    vi.useFakeTimers();
    const { mode, oldEscape } = createMode();

    await handle(mode, { type: "compaction_start", reason: "manual" });
    expect(mode.autoCompactionEscapeHandler).toBe(oldEscape);
    mode.defaultEditor.onEscape?.();
    expect(mode.session.abortCompaction).toHaveBeenCalled();
    await handle(mode, { type: "compaction_progress", currentChunk: 2, totalChunks: 3 });

    await handle(mode, {
      type: "compaction_end",
      reason: "manual",
      result: undefined,
      aborted: true,
      willRetry: false,
    });
    expect(mode.showError).toHaveBeenCalledWith("Compaction cancelled");
    expect(mode.defaultEditor.onEscape).toBe(oldEscape);

    await handle(mode, { type: "compaction_start", reason: "overflow" });
    await handle(mode, {
      type: "compaction_end",
      reason: "overflow",
      result: undefined,
      aborted: true,
      willRetry: true,
    });
    expect(mode.showStatus).toHaveBeenCalledWith("Auto-compaction cancelled");

    await handle(mode, {
      type: "compaction_end",
      reason: "threshold",
      result: { summary: "summary", firstKeptEntryId: "entry", tokensBefore: 1 },
      aborted: false,
      willRetry: false,
    });
    expect(mode.chatContainer.clear).toHaveBeenCalled();
    expect(mode.rebuildChatFromMessages).toHaveBeenCalled();

    await handle(mode, {
      type: "compaction_end",
      reason: "manual",
      result: undefined,
      aborted: false,
      errorMessage: "manual error",
      willRetry: false,
    });
    await handle(mode, {
      type: "compaction_end",
      reason: "threshold",
      result: undefined,
      aborted: false,
      errorMessage: "automatic error",
      willRetry: false,
    });
    expect(mode.showError).toHaveBeenCalledWith("manual error");
    expect(mode.chatContainer.addChild).toHaveBeenCalledTimes(2);
    expect(mode.flushCompactionQueue).toHaveBeenCalledWith({ willRetry: false });
  });

  it("handles retry start, countdown updates, success, and failure", async () => {
    vi.useFakeTimers();
    const { mode, oldEscape } = createMode();
    mode.getRecentModelSwitch.mockReturnValue({ fromModel: "old", toModel: "new" });

    await handle(mode, {
      type: "auto_retry_start",
      attempt: 1,
      maxAttempts: 3,
      delayMs: 1_500,
      errorMessage: "loading",
      reason: "model_loading",
    });
    expect(mode.showRetryProgressInFooter).toHaveBeenCalled();
    mode.defaultEditor.onEscape?.();
    expect(mode.session.abortRetry).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_500);

    await handle(mode, { type: "auto_retry_end", success: true, attempt: 1 });
    expect(mode.defaultEditor.onEscape).toBe(oldEscape);

    await handle(mode, {
      type: "auto_retry_start",
      attempt: 3,
      maxAttempts: 3,
      delayMs: 500,
      errorMessage: "network",
      reason: "transient",
    });
    await handle(mode, { type: "auto_retry_end", success: false, attempt: 3 });
    expect(mode.showError).toHaveBeenCalledWith("Retry failed after 3 attempts: Unknown error");
  });
});
