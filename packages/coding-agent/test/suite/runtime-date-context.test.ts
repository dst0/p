import type { AgentMessage } from "@dst0/p-agent-core";
import { fauxAssistantMessage } from "@dst0/p-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Harness } from "./harness.ts";
import { createHarness, getMessageText } from "./harness.ts";

describe("runtime date context", () => {
  let harness: Harness | undefined;

  afterEach(() => {
    vi.useRealTimers();
    harness?.cleanup();
  });

  it("grounds relative dates per request while keeping the cached system prefix stable", async () => {
    vi.useFakeTimers();
    const systemPrompts: string[] = [];
    const runtimeContexts: string[][] = [];
    harness = await createHarness({ completionMode: "implicit" });
    harness.setResponses([
      (context) => {
        systemPrompts.push(context.systemPrompt ?? "");
        runtimeContexts.push(context.messages.map(getMessageText));
        return fauxAssistantMessage("first");
      },
      (context) => {
        systemPrompts.push(context.systemPrompt ?? "");
        runtimeContexts.push(context.messages.map(getMessageText));
        return fauxAssistantMessage("second");
      },
    ]);

    vi.setSystemTime(new Date("2031-06-15T12:00:00Z"));
    await harness.session.prompt("What does tomorrow mean?");
    const firstRuntimeContext = harness.session._lastRuntimePromptComponents.turnContextPrompt;

    vi.setSystemTime(new Date("2031-06-16T12:00:00Z"));
    await harness.session.prompt("And today?");
    const secondRuntimeContext = harness.session._lastRuntimePromptComponents.turnContextPrompt;

    expect(systemPrompts[0]).toBe(systemPrompts[1]);
    expect(systemPrompts[0]).not.toContain("Current date:");
    expect(firstRuntimeContext).toContain("Current date: 2031-06-15");
    expect(secondRuntimeContext).toContain("Current date: 2031-06-16");
    expect(secondRuntimeContext).toMatch(/today.*tomorrow.*yesterday/iu);
    expect(runtimeContexts[0].some((text) => text.includes("Current date: 2031-06-15"))).toBe(true);
    expect(runtimeContexts[1].some((text) => text.includes("Current date: 2031-06-16"))).toBe(true);
  });

  it("captures a fresh date when steering and follow-up turns are queued after midnight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-06-15T23:59:59"));
    harness = await createHarness({ completionMode: "implicit" });
    const steered: AgentMessage[][] = [];
    const followedUp: AgentMessage[][] = [];
    vi.spyOn(harness.session.agent, "steer").mockImplementation((messages) => {
      steered.push(messages as AgentMessage[]);
    });
    vi.spyOn(harness.session.agent, "followUp").mockImplementation((messages) => {
      followedUp.push(messages as AgentMessage[]);
    });

    vi.setSystemTime(new Date("2031-06-16T00:00:01"));
    await harness.session._queueSteer("What does today mean?");
    await harness.session._queueFollowUp("And tomorrow?");

    for (const queued of [...steered, ...followedUp]) {
      expect(queued.map(getMessageText).join("\n")).toContain("Current date: 2031-06-16");
    }
  });
});
