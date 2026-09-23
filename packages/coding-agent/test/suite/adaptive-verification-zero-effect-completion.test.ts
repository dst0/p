import { fauxAssistantMessage, fauxToolCall } from "@dst0/p-ai";
import { afterEach, describe, expect, it } from "vitest";
import { type AdaptiveHarness, createAdaptiveHarness, tools } from "./adaptive-verification-fixture.ts";

describe("adaptive verification: zero-effect STRICT completion", () => {
  const harnesses: AdaptiveHarness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.harness.cleanup();
  });

  async function setup(): Promise<AdaptiveHarness> {
    const adaptive = await createAdaptiveHarness();
    harnesses.push(adaptive);
    return adaptive;
  }

  function protocolEvents(adaptive: AdaptiveHarness): string[] {
    return adaptive.harness.eventsOfType("completion_protocol").map((event) => event.event);
  }

  it("repairs a clarifying answer to a code task once, then accepts it without ceremony", async () => {
    const adaptive = await setup();
    adaptive.respond(
      fauxAssistantMessage("Should slugify live in src/a.js or a new module?"),
      fauxAssistantMessage("I need to know where slugify should live before changing anything."),
    );

    await adaptive.harness.session.prompt("Implement a slugify helper with tests");

    const [request] = adaptive.requests;
    expect(request?.toolNames).toEqual(
      expect.arrayContaining(["record_task_verification", "finish_work", "update_session_state"]),
    );
    expect(request?.systemPrompt).toContain("If the request needs no file, command, or external change");
    expect(request?.systemPrompt).not.toContain('call action "declare_task" once');
    expect(adaptive.requests).toHaveLength(2);
    expect(protocolEvents(adaptive)).toEqual(["completion_mode", "missing_finish_work_retry"]);
    expect(adaptive.harness.session.getVerificationTierStatus()).toMatchObject({ tier: "strict", reason: "prior" });
  });

  it("rejects a success claim that skipped the requested change", async () => {
    const adaptive = await setup();
    adaptive.respond(
      fauxAssistantMessage("Fixed."),
      tools(fauxToolCall("finish_work", { status: "success", summary: "Fixed the off-by-one bug." })),
      tools(
        fauxToolCall("finish_work", {
          status: "failed",
          summary: "I could not locate src/range.ts.",
          remaining_work: ["Fix the off-by-one bug in src/range.ts"],
        }),
      ),
    );

    await adaptive.harness.session.prompt("Fix the off-by-one bug in src/range.ts");

    const finishes = adaptive.harness
      .eventsOfType("tool_execution_end")
      .filter((event) => event.toolName === "finish_work");
    expect(finishes.map((event) => event.isError)).toEqual([true, false]);
    expect(JSON.stringify(finishes[0]?.result.content)).toContain("requires at least one successful effect");
    expect(protocolEvents(adaptive)).toEqual(["completion_mode", "missing_finish_work_retry", "finish_work_called"]);
    expect(adaptive.requests).toHaveLength(3);
  });

  it("accepts a zero-effect text answer at once when the model declared a code task for a question", async () => {
    const adaptive = await setup();
    adaptive.respond(
      tools(fauxToolCall("begin_code_task", { goal: "Explain slugify", checklist: ["slugify is explained"] })),
      fauxAssistantMessage("slugify lowercases and joins words with dashes."),
    );

    await adaptive.harness.session.prompt("What does slugify do?");

    expect(adaptive.requests).toHaveLength(2);
    expect(protocolEvents(adaptive)).toEqual(["completion_mode"]);
    expect(adaptive.harness.session.getVerificationTierStatus()?.tier).toBe("strict");
  });

  it("completes the controller task on an accepted text answer so later questions are not repaired", async () => {
    const adaptive = await setup();
    adaptive.respond(
      fauxAssistantMessage("Which file holds the range helper?"),
      fauxAssistantMessage("I need the file name before changing anything."),
      fauxAssistantMessage("The helper is exported from src/range.ts."),
    );
    const session = adaptive.harness.session;

    await session.prompt("Fix the off-by-one bug in the range helper");
    expect(session._taskVerificationRuntime?.controller.state.taskPrompts ?? []).toEqual([]);
    await session.prompt("Where is the range helper exported?");

    expect(adaptive.requests).toHaveLength(3);
    expect(session.getVerificationTierStatus()?.tier).toBe("strict");
    expect(protocolEvents(adaptive).filter((event) => event === "missing_finish_work_retry")).toHaveLength(1);
  });
});
