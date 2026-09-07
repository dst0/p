import { describe, expect, it } from "vitest";
import {
  hasSemanticQualifierCoverage,
  strictSemanticQualifierGaps,
} from "../src/core/task-verification/taskverificationcontroller-methods/semantic-qualifier-coverage.ts";

describe("focused-evidence semantic qualifier integrity", () => {
  it("binds exact cardinality to the same local subject", () => {
    expect(strictSemanticQualifierGaps("Write exactly 2 manifest records", "Write exactly 3 manifest records")).toEqual(
      [expect.objectContaining({ qualifier: "exact", values: ["2"] })],
    );
    expect(strictSemanticQualifierGaps("Write exactly 2 input records", "Write exactly 2 output records")).toEqual([
      expect.objectContaining({ qualifier: "exact", anchors: expect.arrayContaining(["input", "records"]) }),
    ]);
    expect(
      strictSemanticQualifierGaps(
        "Write exactly 2 signed manifest records",
        "Write exactly 2 unsigned manifest records",
      ),
    ).toEqual([expect.objectContaining({ qualifier: "exact", values: ["2"] })]);
    expect(
      strictSemanticQualifierGaps(
        "Write exactly 1,000 manifest records",
        "Write exactly one thousand manifest records",
      ),
    ).toEqual([]);
    expect(
      hasSemanticQualifierCoverage("Write exactly 21 manifest records", "Write exactly twenty-one manifest records"),
    ).toBe(true);
  });

  it("keeps ordered subjects distinct", () => {
    expect(
      strictSemanticQualifierGaps("Emit read audit records in order", "Emit write audit records in order"),
    ).toEqual([expect.objectContaining({ qualifier: "order" })]);
    expect(strictSemanticQualifierGaps("Emit records in ascending order", "Emit records in descending order")).toEqual([
      expect.objectContaining({ qualifier: "order", values: ["ascending"] }),
    ]);
    expect(
      strictSemanticQualifierGaps(
        "Accepted audit records are emitted in chronological order",
        "The chronological ordering of accepted audit records is preserved",
      ),
    ).toEqual([]);
  });

  it("ignores informational examples but restores later normative scope", () => {
    expect(
      strictSemanticQualifierGaps(
        "For example, emit exactly 2 demo rows. Actual export emits records.",
        "Actual export emits records",
      ),
    ).toEqual([]);
    expect(
      strictSemanticQualifierGaps(
        "For example, demo rows use two columns; production export must contain exactly 3 records.",
        "Production export contains records",
      ),
    ).toEqual([expect.objectContaining({ qualifier: "exact", values: ["3"] })]);
    expect(
      strictSemanticQualifierGaps(
        "Production export must contain exactly 3 records; for example, demos contain exactly 2 records.",
        "Production export must contain exactly 3 records",
      ),
    ).toEqual([]);
  });
});
