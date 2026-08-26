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

  it("does not treat audit history as a second observable outcome", () => {
    expect(
      compoundHighRiskRequirementError(
        "Never alter audit history in rollback",
        "The rollback value preserves the boundary: never alter audit history",
      ),
    ).toBeUndefined();
  });

  it("counts an imperative audit action as an observable outcome", () => {
    expect(
      compoundHighRiskRequirementError(
        "Atomic rollback must audit access and preserve state",
        "Audit access and preserve state",
      ),
    ).toContain("split each high-risk outcome");
  });

  it("does not treat audited history as an action", () => {
    expect(
      compoundHighRiskRequirementError(
        "Preserve audited history during rollback",
        "The audited history remains preserved",
      ),
    ).toBeUndefined();
  });

  it("does not treat sentence-initial audit history as an action", () => {
    expect(
      compoundHighRiskRequirementError("Preserve audit history during rollback", "Audit history remains preserved"),
    ).toBeUndefined();
  });

  it("counts a subject-led audits action as an observable outcome", () => {
    expect(
      compoundHighRiskRequirementError(
        "Atomic rollback must audit access and preserve state",
        "The service audits access and preserves state",
      ),
    ).toContain("split each high-risk outcome");
  });

  it("counts a modal audit action even when its object is audit-domain data", () => {
    expect(
      compoundHighRiskRequirementError(
        "Security access review",
        "The service must audit history changes and preserve access evidence",
      ),
    ).toContain("split each high-risk outcome");
  });

  it("does not treat an arbitrary sentence-initial audit noun as an action", () => {
    expect(
      compoundHighRiskRequirementError("Preserve audit metadata during rollback", "Audit metadata is retained"),
    ).toBeUndefined();
  });

  it.each([
    "The service is auditing access and preserves access evidence",
    "The service audited access and preserved access evidence",
  ])("counts a subject-led active audit form as an observable outcome: %s", (acceptanceCriterion) => {
    expect(compoundHighRiskRequirementError("Security access review", acceptanceCriterion)).toContain(
      "split each high-risk outcome",
    );
  });

  it("does not treat an adverb-modified audited noun as an action", () => {
    expect(
      compoundHighRiskRequirementError(
        "Preserve audited access records during rollback",
        "Externally audited access records are preserved",
      ),
    ).toBeUndefined();
  });
});
