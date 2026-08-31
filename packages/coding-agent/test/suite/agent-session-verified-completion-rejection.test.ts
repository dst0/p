import { fauxAssistantMessage, fauxToolCall } from "@dst0/p-ai";
import { afterEach, describe, expect, it } from "vitest";
import { resetAfterSuccessfulCompletion } from "../../src/core/task-verification/taskverificationcontroller-methods/completion-lifecycle.ts";
import type { TaskVerificationEvidence } from "../../src/core/task-verification/types.ts";
import { finalizeTaskVerificationCompletion } from "../../src/core/task-verification/verified-completion-runtime.ts";
import { createHarness, type Harness } from "./harness.ts";

describe("AgentSession verified completion rejection", () => {
  let harness: Harness | undefined;

  afterEach(() => {
    harness?.cleanup();
    harness = undefined;
  });

  it("does not terminate a rejected duplicate verdict with matching old readiness", async () => {
    harness = await createHarness({ taskVerificationMode: "audit" });
    const runtime = harness.session._taskVerificationRuntime;
    if (!runtime) throw new Error("Expected audit verification runtime");
    const state = {
      ...runtime.controller.currentState,
      readiness: {
        status: "completion_ready" as const,
        token: "existing-token",
        acceptanceChecks: [{ criterion: "Existing evidence", evidenceRefs: ["existing-evidence"] }],
        verifiedMutationRevision: 0,
        certificateHash: "a".repeat(64),
      },
    };
    runtime.controller.state = state;
    const assistantMessage = fauxAssistantMessage(
      fauxToolCall("record_requirement_audit", { action: "verdict", verdicts: [] }),
      { stopReason: "toolUse" },
    );
    const toolCall = assistantMessage.content[0];
    if (toolCall?.type !== "toolCall") throw new Error("Expected verdict call");

    const result = finalizeTaskVerificationCompletion(
      harness.session,
      runtime,
      {
        assistantMessage,
        toolCall,
        args: toolCall.arguments,
        result: { content: [], details: { status: "needs_action", message: "duplicate", state } },
        isError: false,
        context: { systemPrompt: "test", messages: [], tools: harness.session.agent.state.tools },
      },
      undefined,
    );

    expect(result).toBeUndefined();
    expect(runtime.controller.currentState.readiness?.token).toBe("existing-token");
  });

  it("clears every transient controller ledger after successful completion", async () => {
    harness = await createHarness({ taskVerificationMode: "audit" });
    const runtime = harness.session._taskVerificationRuntime;
    if (!runtime) throw new Error("Expected audit verification runtime");
    const controller = runtime.controller;
    const evidence: TaskVerificationEvidence = {
      version: 2,
      taskId: controller.currentState.taskId,
      ref: "evidence",
      toolCallId: "call",
      toolName: "bash",
      descriptor: "test command",
      outputSummary: "passed",
      isError: false,
      mutationRevision: 1,
      timestamp: new Date().toISOString(),
    };
    controller.evidence.set(evidence.ref, evidence);
    controller.bashFingerprints.set("call", "fingerprint");
    controller.testMutationReservations.set("call", ["test.ts"]);
    controller.testVerificationStarts.set("call", {
      mutationAttemptRevision: 1,
      mutationRevision: 1,
      unverifiedTestPaths: ["test.ts"],
    });
    controller.workspaceTestSnapshots.set("call", undefined);
    controller.workspaceSourceSnapshots.set("call", undefined);
    controller.activeMutationAttempts.add("call");
    controller.requirementSourceTexts.set("source", "requirement");
    controller.latestUserPrompt = "old prompt";

    resetAfterSuccessfulCompletion(controller);

    expect([
      controller.evidence.size,
      controller.bashFingerprints.size,
      controller.testMutationReservations.size,
      controller.testVerificationStarts.size,
      controller.workspaceTestSnapshots.size,
      controller.workspaceSourceSnapshots.size,
      controller.activeMutationAttempts.size,
      controller.requirementSourceTexts.size,
    ]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(controller.latestUserPrompt).toBe("");
    expect(controller.currentState.mutationRevision).toBe(0);
  });
});
