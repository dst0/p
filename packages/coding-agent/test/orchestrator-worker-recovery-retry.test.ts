import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@dst0/p-agent-core";
import { type AssistantMessage, type AssistantMessageEvent, EventStream, getModel } from "@dst0/p-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MODEL_RECOVERY_BASE_DELAY_MS,
  MODEL_RECOVERY_MIN_RETRIES,
  MODEL_RECOVERY_RETRY_PATTERN,
} from "../src/core/agent-session/constants.ts";
import { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createTestResourceLoader } from "./utilities.ts";

class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
  constructor() {
    super(
      (event) => event.type === "done" || event.type === "error",
      (event) => {
        if (event.type === "done") return event.message;
        if (event.type === "error") return event.error;
        throw new Error("Unexpected event type");
      },
    );
  }
}

function createAssistantMessage(text: string, overrides?: Partial<AssistantMessage>): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-completions",
    provider: "openai",
    model: "mock",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("orchestrator worker recovery retry", () => {
  let session: AgentSession;
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `pi-orc-retry-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (session) {
      session.dispose();
    }
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
  });

  it("matches 'no workers ready' orchestrator variants in MODEL_RECOVERY_RETRY_PATTERN", () => {
    const errorMessages = [
      // Exact llm-orchestrator 3eaf9f2 wordings (server handlers.rs, core routing_error.rs, worker model_switcher.rs).
      "API error (503): 503 No workers ready for group: mini-pc/qwen3.8-27b-iq4xs",
      "no available workers for model: mini-pc/qwen3.8-27b-iq4xs",
      "model mini-pc/qwen3.8-27b-iq4xs not ready after 300s on 127.0.0.1:8080",
      "503 No workers ready for group: foo",
      "No ready workers for group: bar",
      "no workers ready",
      "no ready workers",
      "workers not ready",
      "no workers available",
      "no available workers",
      "workers unavailable",
      "loading model",
    ];

    for (const msg of errorMessages) {
      expect(MODEL_RECOVERY_RETRY_PATTERN.test(msg), `Expected pattern to match: "${msg}"`).toBe(true);
    }
  });

  it("does not give non-recovery failures the extended model-recovery budget", () => {
    const errorMessages = [
      "401 Unauthorized: invalid api key",
      "400 Bad Request: context length exceeded",
      "workers ready for group: bar",
      "rate limit exceeded",
    ];

    for (const msg of errorMessages) {
      expect(MODEL_RECOVERY_RETRY_PATTERN.test(msg), `Expected pattern not to match: "${msg}"`).toBe(false);
    }
  });

  it("applies extended retry budget and linear delays for 'no workers ready' 503 errors", async () => {
    vi.useFakeTimers();
    try {
      let callCount = 0;
      const orcError = "API error (503): 503 No workers ready for group: mini-pc/qwen3.8-27b-iq4xs";
      const model = getModel("anthropic", "claude-sonnet-4-5")!;
      const agent = new Agent({
        getApiKey: () => "test-key",
        completionMode: "implicit",
        initialState: { model, systemPrompt: "Test", tools: [] },
        streamFn: () => {
          callCount++;
          const stream = new MockAssistantStream();
          queueMicrotask(() => {
            if (callCount <= 4) {
              const msg = createAssistantMessage("", {
                stopReason: "error",
                errorMessage: orcError,
              });
              stream.push({ type: "start", partial: msg });
              stream.push({ type: "error", reason: "error", error: msg });
            } else {
              const msg = createAssistantMessage("Success after model loaded");
              stream.push({ type: "start", partial: msg });
              stream.push({ type: "done", reason: "stop", message: msg });
            }
          });
          return stream;
        },
      });

      const sessionManager = SessionManager.inMemory();
      const settingsManager = SettingsManager.create(tempDir, tempDir);
      const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
      const modelRegistry = ModelRegistry.create(authStorage, tempDir);
      authStorage.setRuntimeApiKey("anthropic", "test-key");
      settingsManager.applyOverrides({ retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } });

      session = new AgentSession({
        agent,
        sessionManager,
        settingsManager,
        cwd: tempDir,
        modelRegistry,
        resourceLoader: createTestResourceLoader(),
        completionMode: "implicit",
      });

      const retryStarts: Array<{ attempt: number; maxAttempts: number; delayMs: number; reason: string }> = [];
      session.subscribe((event) => {
        if (event.type === "auto_retry_start") {
          retryStarts.push({
            attempt: event.attempt,
            maxAttempts: event.maxAttempts,
            delayMs: event.delayMs,
            reason: event.reason,
          });
        }
      });

      const promptPromise = session.prompt("Test prompt");
      await vi.runAllTimersAsync();
      await promptPromise;

      expect(callCount).toBe(5);
      expect(retryStarts).toHaveLength(4);
      expect(retryStarts[0]).toEqual({
        attempt: 1,
        maxAttempts: MODEL_RECOVERY_MIN_RETRIES,
        delayMs: MODEL_RECOVERY_BASE_DELAY_MS,
        reason: "model_loading",
      });
      expect(retryStarts[3]).toEqual({
        attempt: 4,
        maxAttempts: MODEL_RECOVERY_MIN_RETRIES,
        delayMs: MODEL_RECOVERY_BASE_DELAY_MS * 4,
        reason: "model_loading",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
