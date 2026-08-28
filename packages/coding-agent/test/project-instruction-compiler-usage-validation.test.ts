import { describe, expect, it } from "vitest";
import { parseProjectInstructionCompilerUsage } from "../src/core/project-instructions/compiler-usage.ts";

describe("project instruction compiler usage validation", () => {
  it("rejects non-finite, negative, and incomplete usage totals", () => {
    const baseline = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 };

    expect(
      parseProjectInstructionCompilerUsage({ ...baseline, total: Number.POSITIVE_INFINITY }, false),
    ).toBeUndefined();
    expect(parseProjectInstructionCompilerUsage({ ...baseline, input: -1 }, false)).toBeUndefined();
    expect(parseProjectInstructionCompilerUsage({ ...baseline, output: undefined }, false)).toBeUndefined();
  });
});
