import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionRuntime } from "../../src/core/agent-session-runtime.ts";
import { handleRpcCommand } from "../../src/modes/rpc/rpc-mode/rpc-command-handler.ts";
import { createHarness, type Harness } from "./harness.ts";

describe("AgentSession provider-length fork messages", () => {
  const harnesses: Harness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });

  it("omits internal continuation controls from branching and RPC fork-message lists", async () => {
    const harness = await createHarness();
    harnesses.push(harness);
    const firstId = harness.sessionManager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "Create the long report" }],
      timestamp: Date.now() - 2_000,
    });
    harness.sessionManager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "Continue exactly after the provider-limited segment." }],
      metadata: { pInternal: "provider_length_continuation" },
      timestamp: Date.now() - 1_000,
    });
    const secondId = harness.sessionManager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "Add an executive summary" }],
      timestamp: Date.now(),
    });
    const expected = [
      { entryId: firstId, text: "Create the long report" },
      { entryId: secondId, text: "Add an executive summary" },
    ];

    expect(harness.session.getUserMessagesForForking()).toEqual(expected);
    const response = await handleRpcCommand(
      {
        output: vi.fn(),
        rebindSession: vi.fn(async () => {}),
        runtimeHost: { session: harness.session } as unknown as AgentSessionRuntime,
      },
      { id: "fork-messages", type: "get_fork_messages" },
    );
    expect(response).toMatchObject({ success: true, data: { messages: expected } });
  });
});
