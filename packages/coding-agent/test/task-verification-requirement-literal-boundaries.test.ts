import { describe, expect, it } from "vitest";
import {
  maskScalarLiterals,
  splitSourceClauses,
} from "../src/core/task-verification/requirement-literal-boundaries.ts";

describe("task verification requirement literal boundaries", () => {
  it("masks quoted and multi-delimiter code contents while preserving every boundary", () => {
    const input = 'Keep "alpha; beta" and `gamma? delta` plus ``epsilon ` zeta`` and ‘don’t split!’.';
    const masked = maskScalarLiterals(input);

    expect(masked).toBe(
      `Keep "${" ".repeat(11)}" and \`${" ".repeat(12)}\` plus \`\`${" ".repeat(14)}\`\` and ‘${" ".repeat(12)}’.`,
    );
    expect(masked).toHaveLength(input.length);
  });

  it("does not treat escaped delimiters, unmatched delimiters, contractions, or inch marks as scalar literals", () => {
    const escapedAndUnmatched = 'Escaped \\"not quote\\" and \\`not code\\`; unmatched "quote and `code';
    expect(maskScalarLiterals(escapedAndUnmatched)).toBe(escapedAndUnmatched);

    const mixed = `Don't mask 12" pipe, but 'mask me' and “mask too”.`;
    expect(maskScalarLiterals(mixed)).toBe(`Don't mask 12" pipe, but '${" ".repeat(7)}' and “${" ".repeat(8)}”.`);
  });

  it("keeps escaped quotes inside a scalar literal instead of closing it early", () => {
    const input = 'Keep "alpha \\"quoted\\" beta" visible.';

    expect(maskScalarLiterals(input)).toBe(`Keep "${" ".repeat(21)}" visible.`);
  });

  it("keeps punctuation inside quotes and code spans while splitting exterior sentence boundaries", () => {
    expect(
      splitSourceClauses('Run "a;b? c". Then `x;y. z`! Next\\;still same; Final??  Done.').map((part) => part.trim()),
    ).toEqual(['Run "a;b? c".', "Then `x;y. z`!", "Next\\;still same", "Final??", "Done."]);
  });

  it("handles contractions and smart-quote apostrophes without ending their containing clause", () => {
    expect(splitSourceClauses("It's ready. Don't split apostrophes? Next.")).toEqual([
      "It's ready.",
      "Don't split apostrophes?",
      "Next.",
    ]);
    expect(splitSourceClauses("Say ‘don’t stop. yet’; Continue.").map((part) => part.trim())).toEqual([
      "Say ‘don’t stop. yet’",
      "Continue.",
    ]);
  });

  it("requires an exact backtick-run length before closing a code span", () => {
    const input = "Check ``inner ` tick. still``. Outside.";

    expect(maskScalarLiterals(input)).toBe(`Check \`\`${" ".repeat(19)}\`\`. Outside.`);
    expect(splitSourceClauses(input)).toEqual(["Check ``inner ` tick. still``.", "Outside."]);
  });
});
