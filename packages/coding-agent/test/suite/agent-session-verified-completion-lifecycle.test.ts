import type { AfterToolCallContext, AfterToolCallResult } from "@dst0/p-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@dst0/p-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { InstalledTaskVerificationRuntime } from "../../src/core/agent-session/task-verification-runtime-state.ts";
import {
  computeRequirementSetHash,
  computeStateUserRequirementsHash,
} from "../../src/core/task-verification/requirement-audit-hashing.ts";
import type {
  RequirementAuditInput,
  TaskRequirement,
  TaskVerificationEvidence,
  VerificationResult,
} from "../../src/core/task-verification/types.ts";
import {
  finalizeTaskVerificationCompletion,
  taskVerificationFinalizerBatchError,
} from "../../src/core/task-verification/verified-completion-runtime.ts";
import { createHarness, type Harness } from "./harness.ts";

describe("AgentSession verified completion lifecycle", () => {
  let harness: Harness | undefined;

  afterEach(() => {
    harness?.cleanup();
    harness = undefined;
  });

  it("rejects a finalizer omitted from its claimed assistant turn", async () => {
    harness = await createHarness({ taskVerificationMode: "audit" });
    const runtime = requiredRuntime(harness);
    const assistantMessage = fauxAssistantMessage(
      fauxToolCall("record_requirement_audit", { action: "verdict", verdicts: [] }),
      { stopReason: "toolUse" },
    );
    const missingCall = fauxToolCall("record_requirement_audit", { action: "verdict", verdicts: [] });

    expect(
      taskVerificationFinalizerBatchError(runtime, {
        assistantMessage,
        toolCall: missingCall,
        args: missingCall.arguments,
        context: sessionContext(harness),
      }),
    ).toBe("A certificate-producing verification action requires complete assistant-turn context.");
  });

  it("blocks batched finalization while preserving the prior result", async () => {
    harness = await createHarness({ taskVerificationMode: "audit" });
    const runtime = requiredRuntime(harness);
    const finalizer = fauxToolCall("record_requirement_audit", { action: "verdict", verdicts: [] });
    const assistantMessage = fauxAssistantMessage([finalizer, fauxToolCall("read", { path: "result.txt" })], {
      stopReason: "toolUse",
    });
    const details = { source: "previous-result" };
    const previousResult: AfterToolCallResult = {
      content: [{ type: "text", text: "controller accepted the verdict" }],
      details,
      isError: false,
      terminate: true,
    };

    const result = finalizeTaskVerificationCompletion(
      harness.session,
      runtime,
      afterContext(harness, assistantMessage, finalizer, { source: "native-result" }),
      previousResult,
    );

    expect(result).toMatchObject({ details, isError: true, terminate: false });
    expect(result?.content).toEqual([
      { type: "text", text: "controller accepted the verdict" },
      { type: "text", text: "Verified completion blocked: the certificate-producing action was batched." },
    ]);
  });

  it("does not finalize an incomplete certificate and blocks an in-flight mutation", async () => {
    harness = await createHarness({ taskVerificationMode: "audit" });
    const runtime = requiredRuntime(harness);
    const finalizer = fauxToolCall("record_requirement_audit", { action: "verdict", verdicts: [] });
    const assistantMessage = fauxAssistantMessage(finalizer, { stopReason: "toolUse" });
    runtime.controller.state = {
      ...runtime.controller.state,
      readiness: { status: "completion_ready", acceptanceChecks: [] },
    };
    const incomplete = resultForCurrentState(runtime);

    expect(
      finalizeTaskVerificationCompletion(
        harness.session,
        runtime,
        afterContext(harness, assistantMessage, finalizer, incomplete),
        undefined,
      ),
    ).toBeUndefined();

    runtime.controller.state = {
      ...runtime.controller.state,
      mutationRevision: 1,
      readiness: {
        status: "completion_ready",
        token: "token",
        acceptanceChecks: [],
        verifiedMutationRevision: 1,
        certificateHash: "a".repeat(64),
      },
    };
    runtime.controller.activeMutationAttempts.add("write-in-flight");
    const completeShape = resultForCurrentState(runtime);
    const blocked = finalizeTaskVerificationCompletion(
      harness.session,
      runtime,
      afterContext(harness, assistantMessage, finalizer, completeShape),
      undefined,
    );

    expect(blocked).toMatchObject({ details: completeShape, isError: true, terminate: false });
    expect(textContent(blocked)).toContain("another workspace operation is still in flight");
    runtime.controller.activeMutationAttempts.clear();

    const gateBlocked = finalizeTaskVerificationCompletion(
      harness.session,
      runtime,
      afterContext(harness, assistantMessage, finalizer, completeShape),
      undefined,
    );
    expect(gateBlocked).toMatchObject({ isError: true, terminate: false });
    expect(textContent(gateBlocked)).toContain("semantic verification has not passed after mutation revision 1");
  });

  it("keeps a valid completion certificate nonterminal while a required check fails", async () => {
    harness = await createHarness({ taskVerificationMode: "audit" });
    const runtime = requiredRuntime(harness);
    const { assistantMessage, finalizer, result } = preparePassingAudit(runtime);
    const readiness = runtime.controller.currentState.readiness;
    expect(runtime.controller.completionGate("finish successfully", readiness?.token)).toBeUndefined();
    harness.session._verificationLedger.record("./test.sh", { exitCode: 1, truncated: false });

    const blocked = finalizeTaskVerificationCompletion(
      harness.session,
      runtime,
      afterContext(harness, assistantMessage, finalizer, result),
      undefined,
    );

    expect(blocked).toMatchObject({ details: result, isError: true, terminate: false });
    expect(textContent(blocked)).toContain("required verification checks still fail: ./test.sh (exit 1)");
    expect(runtime.controller.currentState.readiness).toMatchObject({
      status: "completion_ready",
      token: readiness?.token,
    });
  });
});

function requiredRuntime(harness: Harness): InstalledTaskVerificationRuntime {
  const runtime = harness.session._taskVerificationRuntime;
  if (!runtime) throw new Error("Expected audit verification runtime");
  return runtime;
}

function sessionContext(harness: Harness) {
  return {
    systemPrompt: harness.session.agent.state.systemPrompt,
    messages: [],
    tools: harness.session.agent.state.tools,
  };
}

function afterContext(
  harness: Harness,
  assistantMessage: ReturnType<typeof fauxAssistantMessage>,
  toolCall: ReturnType<typeof fauxToolCall>,
  details: unknown,
): AfterToolCallContext {
  return {
    assistantMessage,
    toolCall,
    args: toolCall.arguments,
    result: { content: [{ type: "text", text: "audit result" }], details },
    isError: false,
    context: sessionContext(harness),
  };
}

function resultForCurrentState(runtime: InstalledTaskVerificationRuntime): VerificationResult {
  return { status: "updated", message: "audit updated", state: runtime.controller.currentState };
}

function preparePassingAudit(runtime: InstalledTaskVerificationRuntime) {
  const controller = runtime.controller;
  const evidence: TaskVerificationEvidence = {
    version: 2,
    taskId: controller.currentState.taskId,
    ref: "verification-evidence-1",
    toolCallId: "verify-call",
    toolName: "bash",
    descriptor: "node verify-result.js",
    outputSummary: "verified",
    isError: false,
    mutationRevision: 1,
    timestamp: new Date().toISOString(),
  };
  const requirement: TaskRequirement = {
    id: "R1",
    type: "behavior",
    text: "The requested result is present",
    acceptanceCriterion: "Focused evidence verifies the result",
    sourcePromptIndexes: [1],
  };
  controller.evidence.set(evidence.ref, evidence);
  controller.state = {
    ...controller.state,
    taskKind: "feature",
    taskSummary: "Create and verify the requested result",
    taskPrompts: [{ id: "user-1", text: "Create and verify the requested result." }],
    mutationRevision: 1,
    taskOwnedPaths: ["result.txt"],
    final: {
      status: "passed",
      expectedBehavior: "The requested result is present",
      observedBehavior: "Focused evidence verified the result",
      method: "focused_test",
      evidenceRefs: [evidence.ref],
      unresolvedFailures: [],
      verifiedMutationRevision: 1,
    },
    updatedAt: new Date().toISOString(),
  };
  const userRequirementsHash = computeStateUserRequirementsHash(controller.state);
  const requirementSetHash = computeRequirementSetHash([requirement], [], []);
  controller.state = {
    ...controller.state,
    readiness: {
      status: "evidence_ready",
      acceptanceChecks: [{ criterion: "The requested result is verified", evidenceRefs: [evidence.ref] }],
      verifiedMutationRevision: 1,
      userRequirementsHash,
      requirementSetHash,
      completionSummary: "Created and verified the requested result.",
    },
    requirementAudit: {
      status: "verifying",
      requirements: [requirement],
      ignoredSourcePrompts: [],
      ignoredSourceClauses: [],
      nextRequirementIndex: 0,
      userRequirementsHash,
      requirementSetHash,
    },
  };
  const input: RequirementAuditInput = {
    action: "verdict",
    verdicts: [
      {
        requirement_id: "R1",
        passed: true,
        reason: "Current focused evidence proves the requested result.",
        evidence_refs: [evidence.ref],
      },
    ],
  };
  const result = controller.applyRequirementAudit(input);
  expect(result).toMatchObject({ status: "updated", state: { readiness: { status: "completion_ready" } } });
  const finalizer = fauxToolCall("record_requirement_audit", input);
  return {
    assistantMessage: fauxAssistantMessage(finalizer, { stopReason: "toolUse" }),
    finalizer,
    result,
  };
}

function textContent(result: AfterToolCallResult | undefined): string {
  return (
    result?.content
      ?.filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("\n") ?? ""
  );
}
