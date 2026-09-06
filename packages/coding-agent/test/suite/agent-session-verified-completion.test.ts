import { existsSync } from "node:fs";
import { fauxAssistantMessage, fauxToolCall } from "@dst0/p-ai";
import { afterEach, describe, expect, it } from "vitest";
import {
  computeRequirementSetHash,
  computeStateUserRequirementsHash,
} from "../../src/core/task-verification/requirement-audit-hashing.ts";
import type { TaskRequirement, TaskVerificationEvidence } from "../../src/core/task-verification/types.ts";
import { taskVerificationFinalizerBatchError } from "../../src/core/task-verification/verified-completion-runtime.ts";
import { createHarness, type Harness } from "./harness.ts";

describe("AgentSession verified completion", () => {
  const harnesses: Harness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });

  it("keeps evidence readiness nonterminal so requested delivery can still run", async () => {
    let providerCalls = 0;
    const harness = await createHarness({ taskVerificationMode: "evidence" });
    harnesses.push(harness);
    harness.setResponses([
      () => {
        providerCalls++;
        return fauxAssistantMessage(
          fauxToolCall("record_task_verification", {
            action: "record_completion_checklist",
            completion_checklist: ["The requested file contains the exact content"],
          }),
          { stopReason: "toolUse" },
        );
      },
      () => {
        providerCalls++;
        return fauxAssistantMessage(fauxToolCall("write", { path: "result.txt", content: "done\n" }), {
          stopReason: "toolUse",
        });
      },
      () => {
        providerCalls++;
        return fauxAssistantMessage(
          fauxToolCall("bash", {
            command:
              "node -e \"const fs=require('fs');if(fs.readFileSync('result.txt','utf8')!=='done\\\\n')process.exit(1);console.log('verified')\"",
          }),
          { stopReason: "toolUse" },
        );
      },
      () => {
        providerCalls++;
        return fauxAssistantMessage(
          fauxToolCall("record_task_verification", {
            action: "ready_to_finish",
            unresolved_failures: [],
          }),
          { stopReason: "toolUse" },
        );
      },
      () => {
        providerCalls++;
        return fauxAssistantMessage(
          fauxToolCall("finish_work", {
            status: "success",
            summary: "Created and verified result.txt.",
            files_changed: ["result.txt"],
          }),
          { stopReason: "toolUse" },
        );
      },
    ]);

    await harness.session.prompt("Create result.txt with the exact content 'done' and verify it.");

    const readinessEnd = harness
      .eventsOfType("tool_execution_end")
      .filter((event) => event.toolName === "record_task_verification")
      .at(-1);
    expect(readinessEnd?.isError).toBe(false);
    expect(readinessEnd?.result.terminate).toBeUndefined();
    expect(readinessEnd?.result.details).not.toHaveProperty("verifiedCompletion");
    expect(harness.eventsOfType("agent_end")).toHaveLength(1);
    expect(
      harness.eventsOfType("completion_protocol").some((event) => event.event === "missing_finish_work_retry"),
    ).toBe(false);
    expect(providerCalls).toBe(5);
    expect(harness.getPendingResponseCount()).toBe(0);
  });

  it("terminates audit mode directly from a sole newly accepted verdict", async () => {
    let providerCalls = 0;
    const harness = await createHarness({ taskVerificationMode: "audit" });
    harnesses.push(harness);
    const runtime = harness.session._taskVerificationRuntime;
    if (!runtime) throw new Error("Expected audit verification runtime");
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
    harness.session.agent.state.messages.push({
      role: "user",
      content: "Create and verify the requested result.",
      timestamp: Date.now(),
    });
    harness.setResponses([
      () => {
        providerCalls++;
        return fauxAssistantMessage(
          fauxToolCall("record_requirement_audit", {
            action: "verdict",
            verdicts: [
              {
                requirement_id: "R1",
                passed: true,
                reason: "Current focused evidence proves the requested result.",
                evidence_refs: [evidence.ref],
              },
            ],
          }),
          { stopReason: "toolUse" },
        );
      },
      () => {
        providerCalls++;
        throw new Error("provider must not be called after verified completion");
      },
    ]);

    await harness.session.agent.continue();

    const verdictEnd = harness
      .eventsOfType("tool_execution_end")
      .find((event) => event.toolName === "record_requirement_audit");
    expect(providerCalls).toBe(1);
    expect(harness.getPendingResponseCount()).toBe(1);
    expect(verdictEnd?.isError).toBe(false);
    expect(verdictEnd?.result.terminate).toBe(true);
    expect(verdictEnd?.result.details).toMatchObject({
      verifiedCompletion: {
        kind: "task_verification_completion",
        status: "success",
        summary: "Created and verified the requested result.",
        files_changed: ["result.txt"],
      },
    });
    expect(harness.eventsOfType("completion_protocol").map((event) => event.event)).toContain(
      "verified_completion_called",
    );
    expect(harness.eventsOfType("agent_end")).toHaveLength(1);
    expect(controller.currentState.mutationRevision).toBe(0);
    expect(controller.currentState.taskPrompts).toEqual([]);
  });

  it("blocks every call when a terminal verdict is mixed with workspace work", async () => {
    let providerCalls = 0;
    const harness = await createHarness({ taskVerificationMode: "audit" });
    harnesses.push(harness);
    const mixedMessage = fauxAssistantMessage(
      [
        fauxToolCall("write", { path: "must-not-exist.txt", content: "unsafe\n" }),
        fauxToolCall("record_requirement_audit", { action: "verdict", verdicts: [] }),
      ],
      { stopReason: "toolUse" },
    );
    const writeCall = mixedMessage.content[0];
    const runtime = harness.session._taskVerificationRuntime;
    if (!runtime || writeCall?.type !== "toolCall") throw new Error("Expected mixed audit runtime fixture");
    expect(
      taskVerificationFinalizerBatchError(runtime, {
        assistantMessage: mixedMessage,
        toolCall: writeCall,
        args: writeCall.arguments,
        context: {
          systemPrompt: harness.session.agent.state.systemPrompt,
          messages: [],
          tools: harness.session.agent.state.tools,
        },
      }),
    ).toContain("sole tool call");
    harness.setResponses([
      () => {
        providerCalls++;
        return mixedMessage;
      },
      () => {
        providerCalls++;
        return fauxAssistantMessage(
          fauxToolCall("finish_work", {
            status: "failed",
            summary: "The invalid mixed terminal batch was blocked.",
            files_changed: [],
            remaining_work: ["Retry the audit verdict as the sole call."],
          }),
          { stopReason: "toolUse" },
        );
      },
    ]);

    await harness.session.prompt("Attempt an invalid mixed terminal batch.");

    const firstBatchEnds = harness
      .eventsOfType("tool_execution_end")
      .filter((event) => event.toolName === "write" || event.toolName === "record_requirement_audit");
    expect(firstBatchEnds).toHaveLength(2);
    expect(firstBatchEnds.every((event) => event.isError && event.executed === false)).toBe(true);
    expect(existsSync(`${harness.tempDir}/must-not-exist.txt`)).toBe(false);
    expect(providerCalls).toBe(2);
  });
});
