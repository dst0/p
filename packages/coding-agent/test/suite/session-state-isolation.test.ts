import { fauxAssistantMessage, fauxToolCall } from "@dst0/p-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInitialStructuredSessionState,
  getLatestStructuredSessionState,
  STRUCTURED_SESSION_STATE_CUSTOM_TYPE,
} from "../../src/core/compaction/index.ts";
import { createHarness, type Harness } from "./harness.ts";

describe("session state isolation", () => {
  const harnesses: Harness[] = [];

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });

  it("proves branch-local latest structured state is used and a sibling branch cannot affect finish_work or reconciliation", async () => {
    const harness = await createHarness();
    harnesses.push(harness);

    const baseState = createInitialStructuredSessionState(harness.sessionManager.getSessionId());
    baseState.canonicalRequest.current = "Goal";

    // Root user message
    const userMsgId = harness.sessionManager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "Start" }],
      timestamp: Date.now(),
    });

    // Branch A state
    const stateA = {
      ...baseState,
      plan: [{ id: "1", text: "Task A", status: "blocked" as const }],
    };
    harness.sessionManager.appendCustomEntry(STRUCTURED_SESSION_STATE_CUSTOM_TYPE, stateA);
    const leafA = harness.sessionManager.getLeafId()!;

    // Check A blocks finish_work due to Task A using AgentSession method
    const reasonA = harness.session._getFinishWorkSessionStateBlockReason({ status: "success" });
    expect(reasonA).toContain("Task A (blocked)");
    expect(reasonA).not.toContain("Task B");

    // Also verify beforeToolCall hook behavior on AgentSession
    const toolCallBlock = fauxToolCall("finish_work", { status: "success" });
    const assistantMsg = fauxAssistantMessage([toolCallBlock]);
    const hookResultA = await harness.session.agent.beforeToolCall?.({
      assistantMessage: assistantMsg,
      toolCall: toolCallBlock,
      args: { status: "success" },
      context: { systemPrompt: "", messages: [] },
    });
    expect(hookResultA).toBeDefined();
    expect(hookResultA?.block).toBe(true);
    expect(hookResultA?.reason).toContain("Task A (blocked)");

    // Branch B from userMsgId
    harness.sessionManager.branch(userMsgId);

    // In Branch B, task A doesn't exist, only Task B
    const stateB = {
      ...baseState,
      plan: [{ id: "2", text: "Task B", status: "in_progress" as const }],
    };
    harness.sessionManager.appendCustomEntry(STRUCTURED_SESSION_STATE_CUSTOM_TYPE, stateB);

    // Check B blocks finish_work due to Task B using AgentSession method
    const reasonB = harness.session._getFinishWorkSessionStateBlockReason({ status: "partial" });
    expect(reasonB).toContain("Task B (in_progress)");
    expect(reasonB).not.toContain("Task A");

    // Reconcile on Branch B (mark in_progress items done)
    harness.session._reconcileSuccessfulFinishWorkState();
    const branchBState = getLatestStructuredSessionState(harness.sessionManager.getBranch());
    expect(branchBState?.plan[0]?.status).toBe("done");

    // Switch back to Branch A
    harness.sessionManager.branch(leafA);

    // Check Branch A still has its isolated state and was unaffected by Branch B reconciliation
    const branchAState = getLatestStructuredSessionState(harness.sessionManager.getBranch());
    expect(branchAState?.plan[0]?.id).toBe("1");
    expect(branchAState?.plan[0]?.status).toBe("blocked");

    const reasonA2 = harness.session._getFinishWorkSessionStateBlockReason({ status: "success" });
    expect(reasonA2).toContain("Task A (blocked)");
    expect(reasonA2).not.toContain("Task B");
  });
});
