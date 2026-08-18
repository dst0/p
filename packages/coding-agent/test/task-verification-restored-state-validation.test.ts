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
});
