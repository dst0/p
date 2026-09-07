import { describe, expect, it } from "vitest";
import { strictSemanticQualifierGaps } from "../src/core/task-verification/taskverificationcontroller-methods/semantic-qualifier-coverage.ts";

describe("authoritative-source semantic scope", () => {
  it("restores normative scope for strong requirements after examples", () => {
    for (const source of [
      "For example, demos emit rows; samples must contain exactly 3 records.",
      "For example, demos emit rows, but samples must contain exactly 3 records.",
    ]) {
      expect(strictSemanticQualifierGaps(source, "Samples contain records")).toEqual([
        expect.objectContaining({ qualifier: "exact", values: ["3"] }),
      ]);
    }
  });

  it("keeps example sections and their continuations informational", () => {
    for (const source of [
      "Examples:\n- Emit exactly 2 CSV rows.\n- Emit exactly 3 JSON rows.",
      "## Examples\n- Emit exactly 2 CSV rows.",
      "For example, emit exactly 2 rows. Another example emits exactly 3 rows.",
    ]) {
      expect(strictSemanticQualifierGaps(source, "")).toEqual([]);
    }
    expect(
      strictSemanticQualifierGaps(
        "For example, emit exactly 2 demo rows. The exporter emits exactly 3 production records.",
        "The exporter emits production records",
      ),
    ).toEqual([expect.objectContaining({ qualifier: "exact", values: ["3"] })]);
    expect(
      strictSemanticQualifierGaps(
        "Examples:\n- Emit exactly 2 demo rows.\nRequirements:\n- Emit exactly 3 production records.",
        "Emit production records",
      ),
    ).toEqual([expect.objectContaining({ qualifier: "exact", values: ["3"] })]);
  });

  it("does not let a different ordered subject satisfy the source", () => {
    expect(
      strictSemanticQualifierGaps("Emit created audit records in order", "Emit deleted audit records in order"),
    ).toEqual([expect.objectContaining({ qualifier: "order" })]);
    expect(
      strictSemanticQualifierGaps(
        "Created audit records are emitted in order",
        "Deleted audit records are emitted in order",
      ),
    ).toEqual([expect.objectContaining({ qualifier: "order" })]);
    expect(
      strictSemanticQualifierGaps(
        "Manifest records are preserved in order",
        "Preserve the ordering of manifest records",
      ),
    ).toEqual([]);
    expect(
      strictSemanticQualifierGaps(
        "Accepted audit records are emitted in chronological order",
        "The chronological ordering of accepted audit records is preserved",
      ),
    ).toEqual([]);
    expect(
      strictSemanticQualifierGaps(
        "Emit supplied records in original order",
        "Preserve the original ordering of supplied records",
      ),
    ).toEqual([]);
  });

  it("does not mistake normative example-domain nouns for examples", () => {
    for (const source of [
      "Examples must contain exactly 3 records.",
      "Demos must contain exactly 3 records.",
      "For example, demos emit rows; examples must contain exactly 3 records.",
    ]) {
      expect(strictSemanticQualifierGaps(source, "The files contain records")).toEqual([
        expect.objectContaining({ qualifier: "exact", values: ["3"] }),
      ]);
    }
    expect(strictSemanticQualifierGaps("Advanced examples must contain exactly 3 records.", "")).toEqual([]);
  });

  it("preserves prohibitions and decimal cardinalities", () => {
    expect(strictSemanticQualifierGaps("No metadata keys may be added.", "Metadata keys may be added.")).toEqual([
      expect.objectContaining({ qualifier: "upper-bound", values: ["0"] }),
    ]);
    expect(strictSemanticQualifierGaps("No metadata keys may be added.", "Add no metadata keys.")).toEqual([]);
    expect(strictSemanticQualifierGaps("No metadata keys may be added.", "Add exactly zero metadata keys.")).toEqual(
      [],
    );
    expect(strictSemanticQualifierGaps("No metadata keys may be added.", "Add zero metadata keys.")).toEqual([]);
    expect(strictSemanticQualifierGaps("No metadata keys may be added.", "Write without metadata keys.")).toEqual([]);
    expect(strictSemanticQualifierGaps("No metadata keys may be added.", "Do not add metadata keys.")).toEqual([]);
    expect(strictSemanticQualifierGaps("No metadata keys may be added.", "Add none of the metadata keys.")).toEqual([]);
    expect(
      strictSemanticQualifierGaps("There is no need to add metadata keys.", "Metadata keys may be added."),
    ).toEqual([]);
    expect(strictSemanticQualifierGaps("Use exactly 2.5 seconds.", "Use exactly 2.9 seconds.")).toEqual([
      expect.objectContaining({ qualifier: "exact", values: ["2.5"] }),
    ]);
    expect(strictSemanticQualifierGaps("Use exactly 2.50 seconds.", "Use exactly 2.5 seconds.")).toEqual([]);
    expect(strictSemanticQualifierGaps("Use exactly .5 seconds.", "Use exactly 0.5 seconds.")).toEqual([]);
    expect(strictSemanticQualifierGaps("Use exactly -2.5 seconds.", "Use exactly +2.5 seconds.")).toEqual([
      expect.objectContaining({ qualifier: "exact", values: ["-2.5"] }),
    ]);
    expect(strictSemanticQualifierGaps("Write exactly 1 000 records.", "Write exactly 1 record.")).toEqual([
      expect.objectContaining({ qualifier: "exact", values: ["1000"] }),
    ]);
    expect(strictSemanticQualifierGaps("Write exactly 1,00,000 records.", "Write exactly 1 record.")).toEqual([
      expect.objectContaining({ qualifier: "exact", values: ["100000"] }),
    ]);
    expect(strictSemanticQualifierGaps("Wait exactly 1/2 second.", "Wait exactly 1 second.")).toEqual([
      expect.objectContaining({ qualifier: "exact", values: ["1/2"] }),
    ]);
    expect(strictSemanticQualifierGaps("Wait exactly 1/2 second.", "Wait exactly 1/3 second.")).not.toEqual([]);
    expect(strictSemanticQualifierGaps("Use exactly 1e3 bytes.", "Use exactly 1e9 bytes.")).not.toEqual([]);
    expect(strictSemanticQualifierGaps("Use exactly one two records.", "Use exactly three records.")).not.toEqual([]);
    expect(strictSemanticQualifierGaps("Use exactly two point five seconds.", "Use exactly 2.5 seconds.")).toEqual([]);
    expect(strictSemanticQualifierGaps("Use exactly 2.5% capacity.", "Use exactly 2.5 capacity.")).toEqual([
      expect.objectContaining({ qualifier: "exact", values: ["2.5%"] }),
    ]);
    expect(strictSemanticQualifierGaps("Pay exactly $2.50.", "Pay exactly 2.50.")).toEqual([
      expect.objectContaining({ qualifier: "exact", values: ["$2.5"] }),
    ]);
    expect(strictSemanticQualifierGaps("Respond no later than 5 seconds.", "Respond within 5 seconds.")).toEqual([]);
    expect(
      strictSemanticQualifierGaps("Within a batch, commands observe earlier effects.", "Commands observe effects."),
    ).toEqual([]);
    expect(strictSemanticQualifierGaps("Retain no less than 5 records.", "Retain at least 5 records.")).toEqual([]);
    expect(strictSemanticQualifierGaps("Wait exactly 2 ms.", "Wait exactly 2 milliseconds.")).toEqual([]);
  });

  it("keeps qualifier subjects inside their sentence and preserves long heads", () => {
    expect(
      strictSemanticQualifierGaps(
        "Write exactly 2 manifest records.",
        "Write exactly 2 logs. Manifest records are documented.",
      ),
    ).toEqual([expect.objectContaining({ qualifier: "exact" })]);
    expect(
      strictSemanticQualifierGaps(
        "Write exactly 2 signed production manifest records.",
        "Write exactly 2 signed production manifest errors.",
      ),
    ).toEqual([expect.objectContaining({ qualifier: "exact" })]);
  });

  it("does not classify conditional only as exactness", () => {
    expect(
      strictSemanticQualifierGaps(
        "Process the file only if validation succeeds.",
        "Process the file only when validation succeeds.",
      ),
    ).toEqual([]);
    expect(
      strictSemanticQualifierGaps(
        "Process the file only provided that validation succeeds.",
        "Process the file only if validation succeeds.",
      ),
    ).toEqual([]);
  });

  it("does not classify free-choice any as universal coverage", () => {
    expect(strictSemanticQualifierGaps("Choose any available flight.", "Choose an available flight.")).toEqual([]);
    expect(strictSemanticQualifierGaps("Any truncation must be rejected.", "Truncation must be rejected.")).not.toEqual(
      [],
    );
  });

  it("matches qualifier subject frames across ordinary paraphrases", () => {
    for (const [source, checklist] of [
      [
        "Every uploaded archive must be validated before extraction.",
        "Validate each uploaded archive before extracting it.",
      ],
      [
        "Write exactly 2 manifest records containing package name and version.",
        "Create exactly two manifest entries with version and package name.",
      ],
      [
        "Return exactly 3 signed production manifest records from the successful batch.",
        "For the successful batch, return exactly three signed production manifest entries.",
      ],
      [
        "Write exactly 2 signed production manifest records atomically.",
        "Atomically write exactly 2 signed production manifest records.",
      ],
      ["Output exactly one final LF byte.", "Output exactly one trailing newline."],
      ["Generate exactly 4 thumbnail images.", "Produce precisely four thumbnail images."],
      ["Every generated file ends with exactly one newline.", "Each generated file has exactly one newline."],
    ]) {
      expect(strictSemanticQualifierGaps(source, checklist)).toEqual([]);
    }
    expect(
      strictSemanticQualifierGaps("Process records in chronological order.", "Handle records chronologically."),
    ).toEqual([]);
    expect(
      strictSemanticQualifierGaps(
        "Process records in reverse chronological order.",
        "Preserve reverse chronological ordering of records.",
      ),
    ).toEqual([]);
    expect(
      strictSemanticQualifierGaps("Write exactly 2 signed billing records.", "Write exactly 2 signed shipping errors."),
    ).not.toEqual([]);
    expect(
      strictSemanticQualifierGaps(
        "Only authorized users may delete records.",
        "Restrict deletion to authorized users.",
      ),
    ).not.toEqual([]);
    expect(
      strictSemanticQualifierGaps(
        "Only authorized users may delete records.",
        "Only authorized users may delete records.",
      ),
    ).toEqual([]);
  });
});
