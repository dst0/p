import { describe, expect, it } from "vitest";
import {
  exactFinalByteProofDomains,
  sourceRequiresExactFinalByteProof,
} from "../src/core/task-verification/evidence-critical-proof-source.ts";

describe("exact final-byte proof source", () => {
  it("derives the obligation only from one shared serialized-artifact domain", () => {
    expect(
      sourceRequiresExactFinalByteProof(
        "exportLog returns newline-terminated JSONL.\nfromLog validates structure. Any truncation or extra data throws ValidationError.",
      ),
    ).toBe(true);
    expect(sourceRequiresExactFinalByteProof("Export newline-terminated JSONL.")).toBe(false);
    expect(
      sourceRequiresExactFinalByteProof(
        "Export newline-terminated JSONL. Image import rejects any image truncation or extra pixels.",
      ),
    ).toBe(false);
    expect(
      sourceRequiresExactFinalByteProof(
        "Export newline-terminated JSONL. Image import rejects removal of the final LF byte from the image.",
      ),
    ).toBe(false);
    expect(
      sourceRequiresExactFinalByteProof(
        "Every non-empty export must end with exactly one LF byte. Separately, manifest import must reject removal of the final LF byte.",
      ),
    ).toBe(false);
    expect(
      sourceRequiresExactFinalByteProof("JSONL export ends with LF. Truncated JSONL must always be rejected."),
    ).toBe(true);
    expect(
      exactFinalByteProofDomains(
        "Export history as deterministic JSON Lines (JSONL), one record per line. A non-empty export must end with exactly one LF byte. Any truncation of a non-empty export must throw, including removal of exactly the final LF byte.",
      ),
    ).toEqual(["serialized-artifact"]);
    expect(
      exactFinalByteProofDomains(
        "Every exported CSV invoice ends with LF. Any truncation of the invoice must be rejected.",
      ),
    ).toEqual(["serialized-artifact"]);
    expect(
      exactFinalByteProofDomains(
        [
          "Every non-empty export must end with exactly one LF byte.",
          "Import must reject malformed JSON, count mismatches, removal of a complete trailing record, and removal of only the final LF byte.",
        ].join("\n"),
      ),
    ).toEqual(["serialized-artifact"]);
    expect(exactFinalByteProofDomains("Export ends with LF. Import must reject removal of the final LF byte.")).toEqual(
      ["serialized-artifact"],
    );
    expect(exactFinalByteProofDomains("Export ends with LF. Final LF byte removal must be rejected.")).toEqual([
      "serialized-artifact",
    ]);
    expect(
      exactFinalByteProofDomains("Export ends with LF. The import must fail if the terminal newline is missing."),
    ).toEqual(["serialized-artifact"]);
  });

  it("does not borrow rejection from another predicate or artifact domain", () => {
    for (const nonRequirement of [
      "Export ends with LF. Removal of the final LF need not be rejected.",
      "Export ends with LF. The import does not reject removal of the final LF byte.",
      "Export ends with LF. Final LF byte removal is allowed and must not fail.",
      "Export ends with LF. There is no requirement to reject removal of the final LF byte.",
      "Export ends with LF. It is false that final LF byte removal must be rejected.",
      "JSONL export ends with LF and any truncation is accepted.",
      "Export history ends with LF. Any history truncation is accepted.",
      "Export ends with LF. Removal of the final LF byte is allowed, but malformed JSON must be rejected.",
      "JSONL export ends with LF. Any truncation is accepted, but malformed JSON must be rejected.",
      "Export ends with LF. Removal of the final LF byte is allowed and malformed JSON must be rejected.",
      "Export ends with LF. Import rejects malformed JSON and does not reject removal of the final LF byte.",
      "Export ends with LF. Import rejects malformed JSON and need not reject removal of the final LF byte.",
      "Export ends with LF. Import rejects malformed JSON, while it does not reject removal of the final LF byte.",
    ]) {
      expect(exactFinalByteProofDomains(nonRequirement)).toEqual([]);
    }
    expect(
      exactFinalByteProofDomains(
        "Every exported CSV invoice ends with LF. Any truncation of the video must be rejected.",
      ),
    ).toEqual([]);
  });
});
