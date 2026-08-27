import { describe, expect, it } from "vitest";
import { compoundHighRiskRequirementError } from "../src/core/task-verification/requirement-definition-atomicity.ts";
import { requirementSourceClauseCatalog } from "../src/core/task-verification/requirement-source-clauses.ts";
import type { TaskVerificationSourcePrompt } from "../src/core/task-verification/types.ts";

const exactSummary = "Payment retries are delayed; no confirmed data loss.";

describe("requirement scalar boundaries", () => {
  it("keeps an inline-code semicolon inside one exact scalar clause", () => {
    const catalog = requirementSourceClauseCatalog(sources());

    expect(catalog.map((clause) => [clause.text, clause.line, clause.part])).toEqual([
      ["Create `handoff.json` with exactly these top-level keys:", 1, 1],
      [`\`summary\`: exactly \`${exactSummary}\``, 2, 1],
    ]);
  });

  it("still splits a structural semicolon after an inline-code scalar", () => {
    const catalog = requirementSourceClauseCatalog([
      {
        id: "mixed-spec",
        kind: "referenced_file",
        path: "SPEC.md",
        text: "`summary`: `delayed; no loss`; validate the artifact.",
      },
    ]);

    expect(catalog.map((clause) => clause.text)).toEqual(["`summary`: `delayed; no loss`", "validate the artifact."]);
  });

  it("keeps a quoted scalar intact while splitting its following structural semicolon", () => {
    const catalog = requirementSourceClauseCatalog([
      {
        id: "quoted-spec",
        kind: "referenced_file",
        path: "SPEC.md",
        text: 'The summary is "delayed; no loss"; validate the artifact.',
      },
    ]);

    expect(catalog.map((clause) => clause.text)).toEqual([
      'The summary is "delayed; no loss"',
      "validate the artifact.",
    ]);
  });

  it("keeps a smart-quoted scalar intact while splitting its following structural semicolon", () => {
    const catalog = requirementSourceClauseCatalog([
      {
        id: "smart-quoted-spec",
        kind: "referenced_file",
        path: "SPEC.md",
        text: "The summary is “delayed; no loss”; validate the artifact.",
      },
    ]);

    expect(catalog.map((clause) => clause.text)).toEqual([
      "The summary is “delayed; no loss”",
      "validate the artifact.",
    ]);
  });

  it("does not pair plural possessive apostrophes across a structural semicolon", () => {
    const catalog = requirementSourceClauseCatalog([
      {
        id: "possessive-spec",
        kind: "referenced_file",
        path: "SPEC.md",
        text: "Keep users' data; archive operators' logs.",
      },
    ]);

    expect(catalog.map((clause) => clause.text)).toEqual(["Keep users' data", "archive operators' logs."]);
  });

  it("keeps a smart-single-quoted contraction inside its scalar boundary", () => {
    const catalog = requirementSourceClauseCatalog([
      {
        id: "smart-single-quoted-spec",
        kind: "referenced_file",
        path: "SPEC.md",
        text: "The summary is ‘Don’t retry; wait’; validate the artifact.",
      },
    ]);

    expect(catalog.map((clause) => clause.text)).toEqual([
      "The summary is ‘Don’t retry; wait’",
      "validate the artifact.",
    ]);
  });

  it("does not pair inch marks across a structural semicolon", () => {
    const catalog = requirementSourceClauseCatalog([
      {
        id: "inch-mark-spec",
        kind: "referenced_file",
        path: "SPEC.md",
        text: 'Use 5" bolts; reject 6" bolts.',
      },
    ]);

    expect(catalog.map((clause) => clause.text)).toEqual(['Use 5" bolts', 'reject 6" bolts.']);
  });

  it("does not treat a semicolon inside a quoted exact scalar as two high-risk outcomes", () => {
    expect(
      compoundHighRiskRequirementError(
        "Set the exact retry summary scalar",
        `The summary is exactly "${exactSummary}"`,
      ),
    ).toBeUndefined();
  });

  it("continues to reject an unquoted structural semicolon between high-risk outcomes", () => {
    expect(
      compoundHighRiskRequirementError(
        "Validate retry rollback outcomes",
        'The retry summary is "delayed; no loss"; state remains unchanged',
      ),
    ).toContain("split each high-risk outcome");
  });

  it("recognizes smart-quoted scalars without hiding a following high-risk outcome", () => {
    expect(
      compoundHighRiskRequirementError(
        "Validate retry rollback outcomes",
        "The retry summary is “delayed; no loss”; state remains unchanged",
      ),
    ).toContain("split each high-risk outcome");
  });

  it("does not treat a semicolon inside a smart-quoted scalar as two high-risk outcomes", () => {
    expect(
      compoundHighRiskRequirementError(
        "Set the exact retry summary scalar",
        "The summary is exactly “Payment retries are delayed; no confirmed data loss.”",
      ),
    ).toBeUndefined();
  });

  it("does not let plural possessives hide a structural high-risk semicolon", () => {
    expect(
      compoundHighRiskRequirementError(
        "Validate retry rollback outcomes",
        "Preserve users' retry data; operators' state remains unchanged",
      ),
    ).toContain("split each high-risk outcome");
  });

  it("does not expose a semicolon inside a smart-single-quoted contraction", () => {
    expect(
      compoundHighRiskRequirementError(
        "Set the exact retry summary scalar",
        "The summary is exactly ‘Don’t retry; wait’",
      ),
    ).toBeUndefined();
  });

  it("does not let inch marks hide a structural high-risk semicolon", () => {
    expect(
      compoundHighRiskRequirementError("Reject invalid security hardware dimensions", 'Use 5" bolts; reject 6" bolts.'),
    ).toContain("split each high-risk outcome");
  });

  it("does not let a contraction hide a structural high-risk semicolon", () => {
    expect(
      compoundHighRiskRequirementError(
        "Validate retry rollback outcomes",
        "Don't accept the retry; state remains unchanged",
      ),
    ).toContain("split each high-risk outcome");
  });

  it("does not pair two contraction apostrophes into a scalar literal", () => {
    expect(
      compoundHighRiskRequirementError(
        "Validate retry rollback outcomes",
        "Don't accept the retry; state can't remain unchanged",
      ),
    ).toContain("split each high-risk outcome");
  });
});

function sources(): TaskVerificationSourcePrompt[] {
  return [
    {
      id: "handoff-spec",
      kind: "referenced_file",
      path: "SPEC.md",
      text: `Create \`handoff.json\` with exactly these top-level keys:\n1. \`summary\`: exactly \`${exactSummary}\``,
    },
  ];
}
