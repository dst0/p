import type { AgentMessage } from "@dst0/p-agent-core";
import type { AssistantMessage, ToolResultMessage } from "@dst0/p-ai";
import { vi } from "vitest";
import type { AgentSessionEvent } from "../src/core/agent-session/session-types.ts";
import type { SessionShutdownEvent } from "../src/index.ts";

type FakeExtensionRunner = {
  hasHandlers: (eventType: string) => boolean;
  emit: ReturnType<typeof vi.fn<(event: SessionShutdownEvent) => Promise<void>>>;
};

type FakeSession = {
  sessionManager: { getHeader: () => object | undefined };
  agent: { waitForIdle: () => Promise<void> };
  state: { messages: AgentMessage[] };
  extensionRunner: FakeExtensionRunner;
  bindExtensions: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  prompt: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
};

type FakeRuntimeHost = {
  session: FakeSession;
  newSession: ReturnType<typeof vi.fn>;
  fork: ReturnType<typeof vi.fn>;
  switchSession: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  setRebindSession: ReturnType<typeof vi.fn>;
};

type AgentEndEvent = Extract<AgentSessionEvent, { type: "agent_end" }>;

export function createAssistantMessage(options?: {
  text?: string;
  stopReason?: AssistantMessage["stopReason"];
  errorMessage?: string;
  toolCall?: { id: string; name: string; arguments: Record<string, unknown> };
}): AssistantMessage {
  const content: AssistantMessage["content"] = [];
  if (options?.text) content.push({ type: "text", text: options.text });
  if (options?.toolCall) content.push({ type: "toolCall", ...options.toolCall });
  return {
    role: "assistant",
    content,
    api: "openai-responses",
    provider: "openai",
    model: "gpt-4o-mini",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: options?.stopReason ?? "stop",
    errorMessage: options?.errorMessage,
    timestamp: Date.now(),
  };
}

export function createRuntimeHost(
  stateMessage: AgentMessage,
  options: {
    stateMessages?: AgentMessage[];
    promptAgentEnds?: AgentMessage[][];
    promptAgentEndBatches?: AgentEndEvent[][];
    promptEventBatches?: AgentSessionEvent[][];
  } = {},
): FakeRuntimeHost {
  const extensionRunner: FakeExtensionRunner = {
    hasHandlers: (eventType: string) => eventType === "session_shutdown",
    emit: vi.fn(async () => {}),
  };
  const state = { messages: options.stateMessages ?? [stateMessage] };
  const promptAgentEnds = [...(options.promptAgentEnds ?? [])];
  const promptAgentEndBatches = [...(options.promptAgentEndBatches ?? [])];
  const promptEventBatches = [...(options.promptEventBatches ?? [])];
  let eventListener: ((event: AgentSessionEvent) => void) | undefined;
  const session: FakeSession = {
    sessionManager: { getHeader: () => undefined },
    agent: { waitForIdle: async () => {} },
    state,
    extensionRunner,
    bindExtensions: vi.fn(async () => {}),
    subscribe: vi.fn((listener: (event: AgentSessionEvent) => void) => {
      eventListener = listener;
      return () => {
        eventListener = undefined;
      };
    }),
    prompt: vi.fn(async () => {
      const promptEvents = promptEventBatches.shift();
      if (promptEvents) {
        for (const event of promptEvents) eventListener?.(event);
        return;
      }
      const eventBatch = promptAgentEndBatches.shift();
      if (eventBatch) {
        for (const event of eventBatch) eventListener?.(event);
        return;
      }
      const agentEndMessages = promptAgentEnds.shift();
      if (agentEndMessages) {
        eventListener?.({ type: "agent_end", messages: agentEndMessages, willRetry: false });
      }
    }),
    reload: vi.fn(async () => {}),
  };

  return {
    session,
    newSession: vi.fn(async () => undefined),
    fork: vi.fn(async () => ({ selectedText: "" })),
    switchSession: vi.fn(async () => undefined),
    dispose: vi.fn(async () => {
      await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    }),
    setRebindSession: vi.fn(),
  };
}

export function createProviderLengthContinuationMessage(): AgentMessage {
  return {
    role: "user",
    content: [{ type: "text", text: "Continue after the provider output limit." }],
    metadata: { pInternal: "provider_length_continuation" },
    timestamp: Date.now(),
  };
}

export function createToolResult(text = "tool result"): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: "tool-1",
    toolName: "read",
    content: [{ type: "text", text }],
    isError: false,
    timestamp: Date.now(),
  };
}

export function captureStdout(): { spy: ReturnType<typeof vi.spyOn>; text: () => string } {
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(((_chunk, encodingOrCallback, callback) => {
    const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
    done?.();
    return true;
  }) as typeof process.stdout.write);
  return {
    spy,
    text: () => spy.mock.calls.map(([chunk]) => String(chunk)).join(""),
  };
}

export function createFinishWorkResult(options: {
  status: "success" | "partial" | "failed";
  summary: string;
  result?: string;
}): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: "finish-1",
    toolName: "finish_work",
    content: [{ type: "text", text: options.result ?? options.summary }],
    details: options,
    isError: false,
    timestamp: Date.now(),
  };
}
