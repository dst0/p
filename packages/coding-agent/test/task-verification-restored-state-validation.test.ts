import { describe, expect, it } from "vitest";
import { emptyState } from "../src/core/task-verification/state-factories.ts";
import { isTaskVerificationState } from "../src/core/task-verification/state-validation.ts";

describe("restored task-verification state validation", () => {
  it("preserves well-shaped ignored source-prompt metadata", () => {
    const state = emptyState("validation-task");
    state.requirementAudit.ignoredSourcePrompts = [{ sourcePromptIndex: 1, reason: "Non-requirement context." }];
    expect(isTaskVerificationState(state)).toBe(true);
  });

  it("rejects malformed nested final and readiness collections", () => {
    const state = emptyState("validation-task");
    expect(isTaskVerificationState({ ...state, final: { ...state.final, unresolvedFailures: "not-an-array" } })).toBe(
      false,
    );
    expect(
      isTaskVerificationState({ ...state, readiness: { ...state.readiness, acceptanceChecks: "not-an-array" } }),
    ).toBe(false);
  });

  it("rejects evidence readiness without acceptance evidence", () => {
    const state = emptyState("validation-task");
    expect(
      isTaskVerificationState({
        ...state,
        readiness: {
          status: "evidence_ready",
          acceptanceChecks: [],
          verifiedMutationRevision: 1,
          userRequirementsHash: "requirements-hash",
        },
      }),
    ).toBe(false);
  });

  it.each(["id", "path", "snapshotEntryId"] as const)(
    "rejects duplicate requirement-source %s identities",
    (property) => {
      const state = emptyState("validation-task");
      const first = requirementSourceRef("source-1", "README.md", "snapshot-1");
      const second = requirementSourceRef("source-2", "SPEC.md", "snapshot-2");
      second[property] = first[property];
      state.requirementSourceRefs = [first, second];

      expect(isTaskVerificationState(state)).toBe(false);
    },
  );

  it("rejects overlap between frozen and ignored requirement-source paths", () => {
    const state = emptyState("validation-task");
    state.requirementSourceRefs = [requirementSourceRef("source-1", "README.md", "snapshot-1")];
    state.ignoredRequirementSources = [{ path: "README.md", reason: "Conflicting persisted classification." }];

    expect(isTaskVerificationState(state)).toBe(false);
  });

  it("rejects a malformed requirement-source deauthorization prompt identity", () => {
    const state = emptyState("validation-task");
    state.ignoredRequirementSources = [
      { path: "notes.md", reason: "Directly deauthorized by the user.", deauthorizedByPromptId: 42 as never },
    ];

    expect(isTaskVerificationState(state)).toBe(false);
  });
});

function requirementSourceRef(id: string, path: string, snapshotEntryId: string) {
  return {
    id,
    path,
    sha256: "a".repeat(64),
    byteLength: 12,
    snapshotEntryId,
    referencedByPromptIds: ["user-1"],
    capturedAtMutationRevision: 0,
    origin: "requirement_audit.prepare_definition" as const,
    policyVersion: 1 as const,
  };
}
