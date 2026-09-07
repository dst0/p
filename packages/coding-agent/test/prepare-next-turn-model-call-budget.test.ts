import { Agent } from "@dst0/p-agent-core";
import { describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import { installAgentSessionPrepareNextTurn } from "../src/core/prepare-next-turn.ts";
import type { SettingsManager } from "../src/core/settings-manager.ts";

describe("prepare-next-turn model-call budget", () => {
  it("fails before token estimation when the model cannot reserve output", async () => {
    const agent = new Agent();
    const session = {
      _getEffectiveCompactionSettings: () => ({}),
    } as unknown as AgentSession;
    installAgentSessionPrepareNextTurn(agent, session, {} as SettingsManager);

    await expect(
      agent.prepareModelCall?.({
        context: { systemPrompt: "", messages: [] },
        model: { ...agent.state.model, maxTokens: 0 },
        attempt: 0,
      }),
    ).rejects.toThrow(/could not reserve a positive response budget/iu);
  });
});
