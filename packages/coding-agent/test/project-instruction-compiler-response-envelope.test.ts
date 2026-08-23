import { describe, expect, it } from "vitest";
import { parseProjectInstructionCompilerResponse } from "../src/core/project-instructions/compiler-response.ts";

describe("project instruction compiler response envelope", () => {
  const payload = '{"classifications":{"constraints":{"constraint-1":"always-on"}}}';

  it("accepts one exact, fenced, or prose-wrapped JSON object", () => {
    expect(parseProjectInstructionCompilerResponse(`\uFEFF  ${payload}\n`)).toEqual({
      classifications: { constraints: { "constraint-1": "always-on" } },
    });
    expect(parseProjectInstructionCompilerResponse(`Result:\n\`\`\`json\n${payload}\n\`\`\`\nDone.`)).toEqual({
      classifications: { constraints: { "constraint-1": "always-on" } },
    });
    expect(parseProjectInstructionCompilerResponse(`<think>classification complete</think>\n${payload}`)).toEqual({
      classifications: { constraints: { "constraint-1": "always-on" } },
    });
  });

  it("ignores braces inside JSON strings while finding the complete object", () => {
    expect(
      parseProjectInstructionCompilerResponse('analysis\n{"value":"literal { brace } and \\"quote\\""}\n'),
    ).toEqual({
      value: 'literal { brace } and "quote"',
    });
  });

  it("rejects multiple, truncated, or non-JSON object candidates", () => {
    expect(() => parseProjectInstructionCompilerResponse(`${payload}\n${payload}`)).toThrow(/exactly one/iu);
    expect(() => parseProjectInstructionCompilerResponse(`${payload.slice(0, -1)}`)).toThrow(/complete/iu);
    expect(() => parseProjectInstructionCompilerResponse("{'classifications': {}}")).toThrow(/JSON/iu);
    expect(() => parseProjectInstructionCompilerResponse('{"value":/* comment */1}')).toThrow(/JSON/iu);
  });

  it("selects one sparse contract object from unrelated reasoning JSON but rejects two contracts", () => {
    const isSparseContract = (candidate: unknown) =>
      typeof candidate === "object" &&
      candidate !== null &&
      !Array.isArray(candidate) &&
      Array.isArray((candidate as { alwaysOn?: unknown }).alwaysOn);
    expect(
      parseProjectInstructionCompilerResponse('reasoning {"checked":181}\nanswer {"alwaysOn":[]}', isSparseContract),
    ).toEqual({ alwaysOn: [] });
    expect(() =>
      parseProjectInstructionCompilerResponse('{"alwaysOn":[]}\n{"alwaysOn":["constraint-1"]}', isSparseContract),
    ).toThrow(/multiple contract objects/iu);
  });
});
