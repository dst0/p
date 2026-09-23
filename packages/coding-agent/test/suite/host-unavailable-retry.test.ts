import { fauxAssistantMessage } from "@dst0/p-ai";
import { afterEach, describe, expect, it } from "vitest";
import { computeHostUnavailableMaxAttempts } from "../../src/core/agent-session/constants.ts";
import { createHarness, type Harness } from "./harness.ts";

const HOST_UNAVAILABLE_ERROR = "Connection error. (fetch failed -> EHOSTDOWN connect 192.168.1.50:8080)";

describe("host-unavailable retry budget", () => {
  const harnesses: Harness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });

  it("grants the extended host-unavailable budget for a local model host and recovers", async () => {
    // The faux provider's default model baseUrl is http://localhost:0 (see faux/constants.ts),
    // which is local, so this exercises the real classification path, not a stub.
    const harness = await createHarness({
      completionMode: "implicit",
      settings: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 500 } },
    });
    harnesses.push(harness);
    expect(harness.getModel().baseUrl).toBe("http://localhost:0");

    const retryStarts: Array<{ attempt: number; maxAttempts: number; reason: string }> = [];
    harness.session.subscribe((event) => {
      if (event.type === "auto_retry_start") {
        retryStarts.push({ attempt: event.attempt, maxAttempts: event.maxAttempts, reason: event.reason });
      }
    });

    harness.setResponses([
      fauxAssistantMessage("", { stopReason: "error", errorMessage: HOST_UNAVAILABLE_ERROR }),
      fauxAssistantMessage("", { stopReason: "error", errorMessage: HOST_UNAVAILABLE_ERROR }),
      fauxAssistantMessage("", { stopReason: "error", errorMessage: HOST_UNAVAILABLE_ERROR }),
      fauxAssistantMessage("", { stopReason: "error", errorMessage: HOST_UNAVAILABLE_ERROR }),
      fauxAssistantMessage("recovered"),
    ]);

    await harness.session.prompt("test");

    const expectedMaxAttempts = computeHostUnavailableMaxAttempts(500, 600_000);
    expect(expectedMaxAttempts).toBeGreaterThan(3); // proves the budget was actually extended past the configured 3
    expect(retryStarts).toHaveLength(4);
    for (const start of retryStarts) {
      expect(start.reason).toBe("host_unavailable");
      expect(start.maxAttempts).toBe(expectedMaxAttempts);
    }
    expect(harness.faux.state.callCount).toBe(5);
    expect(harness.session.isRetrying).toBe(false);
  });

  it("keeps the default retry budget for the same connect error against a remote base URL", async () => {
    const harness = await createHarness({
      completionMode: "implicit",
      settings: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } },
    });
    harnesses.push(harness);
    // Force the active model to a public base URL; everything else (faux stream) is unchanged.
    harness.session.agent.state.model = { ...harness.getModel(), baseUrl: "https://api.example.com/v1" };

    const retryStarts: Array<{ maxAttempts: number; reason: string }> = [];
    harness.session.subscribe((event) => {
      if (event.type === "auto_retry_start") {
        retryStarts.push({ maxAttempts: event.maxAttempts, reason: event.reason });
      }
    });

    harness.setResponses([
      fauxAssistantMessage("", { stopReason: "error", errorMessage: HOST_UNAVAILABLE_ERROR }),
      fauxAssistantMessage("", { stopReason: "error", errorMessage: HOST_UNAVAILABLE_ERROR }),
      fauxAssistantMessage("", { stopReason: "error", errorMessage: HOST_UNAVAILABLE_ERROR }),
      fauxAssistantMessage("", { stopReason: "error", errorMessage: HOST_UNAVAILABLE_ERROR }),
    ]);

    await harness.session.prompt("test");

    // Default budget (maxRetries: 3) exhausts after 3 attempts; reason falls back to "transient".
    expect(retryStarts).toEqual([
      { maxAttempts: 3, reason: "transient" },
      { maxAttempts: 3, reason: "transient" },
      { maxAttempts: 3, reason: "transient" },
    ]);
    expect(harness.faux.state.callCount).toBe(4);
  });

  it("never grants the extended budget for auth or context-length errors on a local host", async () => {
    const harness = await createHarness({
      completionMode: "implicit",
      settings: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } },
    });
    harnesses.push(harness);

    harness.setResponses([
      fauxAssistantMessage("", { stopReason: "error", errorMessage: "401 Unauthorized: invalid api key" }),
    ]);

    await harness.session.prompt("test");

    expect(harness.eventsOfType("auto_retry_start")).toEqual([]);
    expect(harness.faux.state.callCount).toBe(1);
  });

  it("stops cleanly on Esc/abort while waiting inside the extended host-unavailable backoff", async () => {
    const harness = await createHarness({
      completionMode: "implicit",
      settings: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 5_000 } },
    });
    harnesses.push(harness);

    harness.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: HOST_UNAVAILABLE_ERROR })]);

    const sawRetryStart = new Promise<void>((resolve) => {
      const unsubscribe = harness.session.subscribe((event) => {
        if (event.type === "auto_retry_start") {
          unsubscribe();
          resolve();
        }
      });
    });

    const promptPromise = harness.session.prompt("test");
    await sawRetryStart;
    harness.session.abortRetry();
    await promptPromise;

    expect(harness.session.isRetrying).toBe(false);
    expect(harness.eventsOfType("auto_retry_end").map((event) => event.finalError)).toContain("Retry cancelled");
    expect(harness.faux.state.callCount).toBe(1);
  });
});
