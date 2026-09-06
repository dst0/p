import { describe, expect, it } from "vitest";
import { emptyState } from "../src/core/task-verification/state-factories.ts";
import { isTaskVerificationEvidence, isTaskVerificationState } from "../src/core/task-verification/state-validation.ts";

describe("evidence-mode metadata state validation", () => {
  it("accepts bounded de-authorized critical-proof paths without active-path overlap", () => {
    const state = emptyState("validation-task", "evidence");
    state.criticalProofDeauthorizedSourcePaths = ["SPEC.md"];
    expect(isTaskVerificationState(state)).toBe(true);
    expect(
      isTaskVerificationState({
        ...state,
        criticalProofDeauthorizedSourcePaths: ["SPEC.md", "SPEC.md"],
      }),
    ).toBe(false);
    expect(
      isTaskVerificationState({
        ...state,
        criticalProofDiscoveryFailures: [{ sourcePath: "SPEC.md", reason: "overlap" }],
      }),
    ).toBe(false);
    expect(
      isTaskVerificationState({
        ...state,
        criticalProofDeauthorizedSourcePaths: ["A.md", "B.md", "C.md", "D.md"],
      }),
    ).toBe(true);
    expect(
      isTaskVerificationState({
        ...state,
        criticalProofDeauthorizedSourcePaths: Array.from({ length: 9 }, (_, index) => `S${index}.md`),
      }),
    ).toBe(false);
  });

  it("requires selected critical-proof sources to retain a real prompt epoch", () => {
    const state = emptyState("validation-task", "evidence");
    const sourceSha256 = "a".repeat(64);
    state.taskPrompts = [{ id: "user-1", text: "Use SPEC.md." }];
    state.criticalProofSourceSelections = [{ sourcePath: "SPEC.md", selectedAtPromptId: "user-1", sourceSha256 }];
    expect(isTaskVerificationState(state)).toBe(true);
    expect(
      isTaskVerificationState({
        ...state,
        criticalProofSourceSelections: [{ sourcePath: "SPEC.md", selectedAtPromptId: "missing", sourceSha256 }],
      }),
    ).toBe(false);
    state.criticalProofObligations = [
      {
        id: "boundary-1",
        policy: "remove_exact_final_byte",
        sourcePath: "SPEC.md",
        sourceSha256,
        artifactDomain: "event-log",
      },
    ];
    expect(isTaskVerificationState(state)).toBe(true);
    expect(
      isTaskVerificationState({
        ...state,
        criticalProofSourceSelections: [
          { sourcePath: "SPEC.md", selectedAtPromptId: "user-1", sourceSha256: "b".repeat(64) },
        ],
      }),
    ).toBe(false);
  });

  it("cross-validates frozen source-output authority with selections, obligations, and baselines", () => {
    const state = emptyState("validation-task", "evidence");
    const sha256 = "a".repeat(64);
    state.taskPrompts = [{ id: "user-1", text: "Use and edit SPEC.md.\n[source-output:SPEC.md]" }];
    state.criticalProofSourceSelections = [
      { sourcePath: "SPEC.md", selectedAtPromptId: "user-1", sourceSha256: sha256 },
    ];
    state.criticalProofObligations = [
      {
        id: "boundary-1",
        policy: "remove_exact_final_byte",
        sourcePath: "SPEC.md",
        sourceSha256: sha256,
        artifactDomain: "event-log",
      },
    ];
    state.criticalProofSourceOutputs = [
      {
        sourcePath: "SPEC.md",
        authorizedAtPromptId: "user-1",
        authorizedCriterion: "SPEC.md is the requested edited output",
        baselineState: `file:-:${sha256}`,
        criticalDomains: ["event-log"],
      },
    ];
    expect(isTaskVerificationState(state)).toBe(true);
    expect(
      isTaskVerificationState({
        ...state,
        criticalProofSourceOutputs: [{ ...state.criticalProofSourceOutputs[0]!, authorizedAtPromptId: "missing" }],
      }),
    ).toBe(false);
    expect(
      isTaskVerificationState({
        ...state,
        criticalProofSourceOutputs: [{ ...state.criticalProofSourceOutputs[0]!, criticalDomains: [] }],
      }),
    ).toBe(false);
    expect(isTaskVerificationState({ ...state, taskOwnedPaths: ["SPEC.md"] })).toBe(false);
    expect(isTaskVerificationState({ ...state, criticalProofObligations: undefined })).toBe(false);
    expect(
      isTaskVerificationState({
        ...state,
        criticalProofObligations: undefined,
        criticalProofObligationOverflow: true,
      }),
    ).toBe(true);
    expect(
      isTaskVerificationState({
        ...state,
        taskOwnedPaths: ["SPEC.md"],
        taskOwnedPathBaselines: [{ path: "SPEC.md", state: `file:-:${sha256}` }],
      }),
    ).toBe(true);
  });

  it("validates persisted declared-readback effect metadata", () => {
    const evidence = {
      version: 2,
      taskId: "validation-task",
      ref: "verification-evidence-1",
      toolCallId: "readback-1",
      toolName: "get_event",
      descriptor: "declared external readback",
      outputSummary: "successful metadata-only declared external readback",
      toolEffect: { kind: "read", risk: "normal", domains: ["persistent_state"], source: "declared" },
      isError: false,
      mutationRevision: 1,
      timestamp: new Date(0).toISOString(),
    };
    expect(isTaskVerificationEvidence(evidence)).toBe(true);
    expect(isTaskVerificationEvidence({ ...evidence, toolEffect: { ...evidence.toolEffect, source: "forged" } })).toBe(
      false,
    );
    const confirmed = {
      ...evidence,
      externalReadbackReceiptId: "external-effect-1-1",
      externalReadbackCriterionSha256: "a".repeat(64),
      externalReadbackOutcome: "confirmed" as const,
    };
    expect(isTaskVerificationEvidence(confirmed)).toBe(true);
    expect(isTaskVerificationEvidence({ ...confirmed, externalReadbackCriterionSha256: undefined })).toBe(false);
  });
});
