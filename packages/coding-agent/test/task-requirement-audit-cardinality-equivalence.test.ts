import { describe, expect, it } from "vitest";
import {
  hasSemanticQualifierCoverage,
  strictSemanticQualifierGaps,
} from "../src/core/task-verification/taskverificationcontroller-methods/semantic-qualifier-coverage.ts";

describe("requirement cardinality and source scope", () => {
  it.each([
    ["one hundred and twenty", "120", "121", "Manifest export emits", "records"],
    ["two thousand three hundred and forty five", "2345", "2346", "Manifest export emits", "records"],
    ["one million", "1000000", "1000001", "Manifest export emits", "records"],
    ["one point five", "1.5", "1.6", "The retry timeout lasts", "seconds"],
    ["one point five zero", "1.5", "1.6", "The retry timeout lasts", "seconds"],
    ["one point zero zero", "1", "1.01", "The retry timeout lasts", "seconds"],
    ["one point zero five zero", "1.05", "1.5", "The retry timeout lasts", "seconds"],
    ["+1e+3", "1e+3", "1e+4", "Manifest export emits", "records"],
    ["001/002", "1/2", "1/3", "A transaction transfers", "shares"],
    ["$+01.50", "$1.5", "$1.6", "A transaction charges", "in fees"],
  ])(
    "accepts the same explicit quantity and rejects a different quantity: %s",
    (words, exact, different, subject, unit) => {
      const requirement = `${subject} exactly ${words} ${unit}`;

      expect(strictSemanticQualifierGaps(requirement, `${subject} exactly ${exact} ${unit}`)).toEqual([]);
      expect(hasSemanticQualifierCoverage(requirement, `${subject} exactly ${exact} ${unit}`)).toBe(true);
      expect(hasSemanticQualifierCoverage(requirement, `${subject} exactly ${different} ${unit}`)).toBe(false);
      expect(hasSemanticQualifierCoverage(requirement, `${subject} ${unit}`)).toBe(false);
    },
  );

  it("retains units, currency, and exponent identity while normalizing decimal presentation", () => {
    expect(
      hasSemanticQualifierCoverage(
        "The retry timeout lasts exactly one point zero seconds",
        "The retry timeout lasts exactly 1 minutes",
      ),
    ).toBe(false);
    expect(
      hasSemanticQualifierCoverage(
        "A transaction charges exactly $1.50 in fees",
        "A transaction charges exactly €1.5 in fees",
      ),
    ).toBe(false);
    expect(
      hasSemanticQualifierCoverage(
        "A transaction charges exactly $1.50 in fees",
        "A transaction charges exactly 1.5 in fees",
      ),
    ).toBe(false);
    expect(
      hasSemanticQualifierCoverage(
        "Manifest export emits exactly 1e+3 records",
        "Manifest export emits exactly 1e-3 records",
      ),
    ).toBe(false);
  });

  it("requires ordering when the source uses a direct preserve-order instruction", () => {
    const requirement = "Manifest records preserve order";

    expect(hasSemanticQualifierCoverage(requirement, "ordered manifest records")).toBe(true);
    expect(hasSemanticQualifierCoverage(requirement, "manifest records remain available")).toBe(false);
  });

  it("keeps a separate zero-attempt constraint after a decimal timeout", () => {
    const source =
      "The retry timeout lasts exactly one point five zero seconds and zero duplicate attempts are emitted";

    expect(
      hasSemanticQualifierCoverage(
        source,
        "The retry timeout lasts exactly 1.5 seconds and zero duplicate attempts are emitted",
      ),
    ).toBe(true);
    expect(strictSemanticQualifierGaps(source, "The retry timeout lasts exactly 1.5 seconds")).toEqual([
      { qualifier: "upper-bound", anchors: ["duplicate", "attempts"], values: ["0"] },
    ]);
    expect(
      hasSemanticQualifierCoverage(
        source,
        "The retry timeout lasts exactly 1.5 seconds and at most 1 duplicate attempts are emitted",
      ),
    ).toBe(false);
  });

  it.each(["# Requirements", "Acceptance criteria:"])(
    "restores normative numeric constraints after an example section at %s",
    (heading) => {
      const source = [
        "# Examples",
        "The preview emits exactly 2 sample records",
        heading,
        "The manifest emits exactly 120 records",
      ].join("\n");

      expect(strictSemanticQualifierGaps(source, "manifest emits exactly 120 records")).toEqual([]);
      expect(strictSemanticQualifierGaps(source, "preview emits exactly 2 sample records")).toEqual([
        { qualifier: "exact", anchors: ["records"], values: ["120"] },
      ]);
    },
  );
});
