import type { AgentMessage } from "@dst0/p-agent-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionEvent } from "../src/core/agent-session/session-types.ts";
import { runPrintMode } from "../src/modes/print-mode.ts";
import { captureStdout, createAssistantMessage, createRuntimeHost } from "./print-mode-test-support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

/** A runtime host whose `prompt()` stays pending until `resolvePrompt()` is called, so a
 * test can emit SIGINT while `runPrintMode` is still in flight (a real retry wait behaves
 * the same way: the whole prompt() call doesn't settle until the backoff sleep ends). */
function createControllableRuntimeHost(finalMessage: AgentMessage) {
  let eventListener: ((event: AgentSessionEvent) => void) | undefined;
  let resolvePrompt: (() => void) | undefined;
  const session = {
    sessionManager: { getHeader: () => undefined },
    agent: { waitForIdle: async () => {} },
    state: { messages: [] as AgentMessage[] },
    extensionRunner: { hasHandlers: () => false, emit: vi.fn(async () => {}) },
    bindExtensions: vi.fn(async () => {}),
    subscribe: vi.fn((listener: (event: AgentSessionEvent) => void) => {
      eventListener = listener;
      return () => {
        eventListener = undefined;
      };
    }),
    prompt: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePrompt = () => {
            eventListener?.({ type: "agent_end", messages: [finalMessage], willRetry: false });
            resolve();
          };
        }),
    ),
    reload: vi.fn(async () => {}),
    isRetrying: false,
    abortRetry: vi.fn(),
  };
  const runtimeHost = {
    session,
    newSession: vi.fn(async () => undefined),
    fork: vi.fn(async () => ({ selectedText: "" })),
    switchSession: vi.fn(async () => undefined),
    dispose: vi.fn(async () => {}),
    setRebindSession: vi.fn(),
  };
  return { runtimeHost, resolvePrompt: () => resolvePrompt?.() };
}

describe("runPrintMode retry visibility and Ctrl+C", () => {
  it("writes a single stderr line per auto_retry_start in text mode, distinct per reason", async () => {
    const finalMessage = createAssistantMessage({ text: "recovered" });
    const hostUnavailable: AgentSessionEvent = {
      type: "auto_retry_start",
      attempt: 1,
      maxAttempts: 25,
      delayMs: 2_000,
      errorMessage: "Connection error. (fetch failed -> EHOSTDOWN connect 192.168.1.50:8080)",
      reason: "host_unavailable",
    };
    const localServerDown: AgentSessionEvent = {
      type: "auto_retry_start",
      attempt: 2,
      maxAttempts: 3,
      delayMs: 500,
      errorMessage: "Connection error. (fetch failed -> ECONNREFUSED connect 127.0.0.1:1234)",
      reason: "local_server_down",
    };
    const runtimeHost = createRuntimeHost(finalMessage, {
      promptEventBatches: [
        [hostUnavailable, localServerDown, { type: "agent_end", messages: [finalMessage], willRetry: false }],
      ],
    });
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    captureStdout();

    const exitCode = await runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
      mode: "text",
      initialMessage: "prompt",
    });

    expect(exitCode).toBe(0);
    expect(stderr.mock.calls.map((call) => call[0])).toEqual([
      "model host unreachable; retrying in 2s (attempt 1/25), Ctrl+C to stop",
      "local model server not running; retrying in 1s (attempt 2/3), Ctrl+C to stop",
    ]);
  });

  it("does not write a retry line in json mode (the event is already in the event stream)", async () => {
    const finalMessage = createAssistantMessage({ text: "recovered" });
    const event: AgentSessionEvent = {
      type: "auto_retry_start",
      attempt: 1,
      maxAttempts: 3,
      delayMs: 500,
      errorMessage: "overloaded_error",
      reason: "transient",
    };
    const runtimeHost = createRuntimeHost(finalMessage, {
      promptEventBatches: [[event, { type: "agent_end", messages: [finalMessage], willRetry: false }]],
    });
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    captureStdout();

    await runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
      mode: "json",
      initialMessage: "prompt",
    });

    expect(stderr).not.toHaveBeenCalled();
  });

  it("calls session.abortRetry() on SIGINT while a retry is in flight, without exiting the process", async () => {
    const finalMessage = createAssistantMessage({ text: "recovered" });
    const { runtimeHost, resolvePrompt } = createControllableRuntimeHost(finalMessage);
    runtimeHost.session.isRetrying = true;
    captureStdout();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const runPromise = runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
      mode: "text",
      initialMessage: "prompt",
    });
    await Promise.resolve(); // let rebindSession/prompt() start before signalling

    process.emit("SIGINT");
    await Promise.resolve();

    expect(runtimeHost.session.abortRetry).toHaveBeenCalledTimes(1);
    expect(exitSpy).not.toHaveBeenCalled();

    resolvePrompt();
    await runPromise;
    process.removeAllListeners("SIGINT");
  });

  it("falls back to the normal exit path on SIGINT when no retry is in flight", async () => {
    const finalMessage = createAssistantMessage({ text: "recovered" });
    const { runtimeHost, resolvePrompt } = createControllableRuntimeHost(finalMessage);
    runtimeHost.session.isRetrying = false;
    captureStdout();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const runPromise = runPrintMode(runtimeHost as unknown as Parameters<typeof runPrintMode>[0], {
      mode: "text",
      initialMessage: "prompt",
    });
    await Promise.resolve();

    process.emit("SIGINT");
    await new Promise((resolve) => setImmediate(resolve));

    expect(runtimeHost.session.abortRetry).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(130);

    resolvePrompt();
    await runPromise;
    process.removeAllListeners("SIGINT");
  });
});
