import { describe, expect, it } from "vitest";
import { compoundHighRiskRequirementError } from "../src/core/task-verification/requirement-definition-atomicity.ts";

describe("requirement-definition atomicity", () => {
  it("rejects rollback observables hidden together in requirement text", () => {
    expect(
      compoundHighRiskRequirementError(
        "Atomic failed batch restores state, event log, version, position, and command IDs",
        "The batch is all-or-nothing",
      ),
    ).toContain("split each high-risk outcome");
  });

  it("rejects one rollback criterion spanning multiple independent observables", () => {
    expect(
      compoundHighRiskRequirementError(
        "Atomic failed batch rollback",
        "A failed batch rolls back state, event log, version, position, and command IDs",
      ),
    ).toContain("split each high-risk outcome");
  });

  it("does not treat a dotted TypeScript export path as multiple sentences", () => {
    expect(
      compoundHighRiskRequirementError(
        "Export ConcurrencyError from src/index.ts",
        "src/index.ts exports ConcurrencyError",
      ),
    ).toBeUndefined();
  });

  it("continues to reject genuinely multi-sentence high-risk criteria", () => {
    expect(
      compoundHighRiskRequirementError(
        "Reject concurrency failure",
        "Concurrency failure is rejected. State remains unchanged.",
      ),
    ).toContain("split each high-risk outcome");
  });

  it("still counts a sentence boundary after a dotted path", () => {
    expect(
      compoundHighRiskRequirementError(
        "Export ConcurrencyError from src/index.ts",
        "Inspect src/index.ts. The public facade exports ConcurrencyError.",
      ),
    ).toContain("split each high-risk outcome");
  });
});
