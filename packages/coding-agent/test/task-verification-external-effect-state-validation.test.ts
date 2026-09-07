import { describe, expect, it } from "vitest";
import { emptyState } from "../src/core/task-verification/state-factories.ts";
import { isTaskVerificationState } from "../src/core/task-verification/state-validation.ts";

function receipt(revision: number, id = `external-effect-${revision}-1`) {
  return {
    id,
    toolCallId: `call-${revision}`,
    toolName: "send_email",
    effect: {
      kind: "external_write" as const,
      risk: "high" as const,
      domains: ["network_send" as const],
      source: "declared" as const,
    },
    effectRevision: revision,
  };
}

describe("restored external-effect receipt validation", () => {
  it("accepts one external receipt for each positive effect revision", () => {
    const state = emptyState("external-state", "evidence");
    state.mutationRevision = 2;
    state.externalEffectReceipts = [receipt(1), receipt(2)];

    expect(isTaskVerificationState(state)).toBe(true);
  });

  it.each(["read", "workspace_write"] as const)("rejects a persisted %s receipt", (kind) => {
    const state = emptyState("external-state", "evidence");
    state.mutationRevision = 1;
    state.externalEffectReceipts = [{ ...receipt(1), effect: { ...receipt(1).effect, kind } }];

    expect(isTaskVerificationState(state)).toBe(false);
  });

  it("rejects zero, duplicate revision, and duplicate call identity receipts", () => {
    const state = emptyState("external-state", "evidence");
    state.mutationRevision = 2;
    const first = receipt(1);
    expect(isTaskVerificationState({ ...state, externalEffectReceipts: [receipt(0)] })).toBe(false);
    expect(
      isTaskVerificationState({
        ...state,
        externalEffectReceipts: [first, { ...receipt(1, "external-effect-1-2"), toolCallId: "call-other" }],
      }),
    ).toBe(false);
    expect(
      isTaskVerificationState({
        ...state,
        externalEffectReceipts: [first, { ...receipt(2), toolCallId: first.toolCallId }],
      }),
    ).toBe(false);
  });
});
