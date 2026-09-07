import { fauxAssistantMessage } from "@dst0/p-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.ts";

function providerMessage(harness: Harness, text: string, stopReason: "length" | "stop", timestamp: number) {
  const model = harness.getModel();
  return {
    ...fauxAssistantMessage(text, { stopReason, timestamp }),
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 2_000,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2_000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

describe("AgentSession provider-length compaction state", () => {
  const harnesses: Harness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });

  it("keeps provider-length controls out of the default compaction canonical request", async () => {
    const harness = await createHarness({
      withConfiguredAuth: false,
      settings: { compaction: { keepRecentTokens: 10 } },
    });
    harnesses.push(harness);
    const realRequest = "Build a universal response that safely continues after provider output limits. "
      .repeat(60)
      .trim();
    const internalContinuation = "Continue exactly after the final completed content above.";
    const now = Date.now();
    harness.sessionManager.appendMessage({
      role: "user",
      content: [{ type: "text", text: realRequest }],
      timestamp: now - 2_000,
    });
    harness.sessionManager.appendMessage(
      providerMessage(harness, "completed provider-limited segment", "length", now - 1_500),
    );
    harness.sessionManager.appendMessage({
      role: "user",
      content: [{ type: "text", text: internalContinuation }],
      metadata: { pInternal: "provider_length_continuation" },
      timestamp: now - 1_000,
    });
    harness.sessionManager.appendMessage(providerMessage(harness, "completed tail", "stop", now - 500));
    harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;

    const result = await harness.session.compact();
    const details = result.details as {
      structuredState?: {
        canonicalRequest: { current: string; originalRequests: Array<{ text: string }> };
      };
    };

    expect(details.structuredState?.canonicalRequest.originalRequests.map((request) => request.text)).toEqual([
      realRequest,
    ]);
    expect(details.structuredState?.canonicalRequest.current).not.toContain(internalContinuation);
    expect(
      harness.sessionManager
        .getEntries()
        .filter(
          (entry) =>
            entry.type === "message" &&
            entry.message.role === "user" &&
            entry.message.metadata?.pInternal === "provider_length_continuation",
        ),
    ).toHaveLength(1);
  });
});
