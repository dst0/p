import { describe, expect, it } from "vitest";
import {
  findReasoningActionLoop,
  findRepetitiveOutputSuffix,
  findRepetitiveToolCallSuffix,
  trimRepetitiveSuffix,
} from "../src/utils/repetition.ts";

describe("tool-call repetition detection", () => {
  it("detects repeated tool-protocol closing tags in streamed arguments", () => {
    const argumentsText = `{"edits":[{"oldText":"interface BaseEvent {"${" </function>".repeat(500)}`;

    const repetition = findRepetitiveToolCallSuffix(argumentsText);

    expect(repetition).toBeDefined();
    expect(trimRepetitiveSuffix(argumentsText, repetition!)).toBe(
      '{"edits":[{"oldText":"interface BaseEvent {" </function> </function>',
    );
  });

  it("does not flag a short malformed suffix", () => {
    const argumentsText = `{"oldText":"value"${" </function>".repeat(40)}`;

    expect(findRepetitiveToolCallSuffix(argumentsText)).toBeUndefined();
  });

  it("requires at least eight complete repetitions in the detection window", () => {
    const repeatedUnit = "x".repeat(128);
    const variedPrefix = Array.from({ length: 256 }, (_, index) => String.fromCharCode(33 + (index % 90))).join("");
    const argumentsText = variedPrefix + repeatedUnit.repeat(7);

    expect(findRepetitiveToolCallSuffix(argumentsText)).toBeUndefined();
  });

  it("detects an arbitrary repeated phrase in streamed arguments", () => {
    const repeatedPhrase = " retry the same edit";
    const argumentsText = `{"oldText":"value${repeatedPhrase.repeat(100)}`;

    const repetition = findRepetitiveToolCallSuffix(argumentsText);

    expect(repetition).toBeDefined();
    expect(trimRepetitiveSuffix(argumentsText, repetition!)).toBe(
      `{"oldText":"value${repeatedPhrase}${repeatedPhrase}`,
    );
  });

  it("detects a repeated single-character argument tail", () => {
    expect(findRepetitiveToolCallSuffix(`{"content":"${"x".repeat(2048)}`)).toBeDefined();
  });

  it("does not impose a size limit on varied arguments", () => {
    const content = Array.from(
      { length: 10_000 },
      (_, index) => `line-${index.toString(36)}-${(index * index).toString(36)}`,
    ).join("\n");

    expect(findRepetitiveToolCallSuffix(JSON.stringify({ content }))).toBeUndefined();
  });

  it("detects repeated prose and preserves one copy of the repeated unit", () => {
    const usefulPrefix = "I inspected the implementation. ";
    const repeatedSentence = "The next step is to update the file. ";
    const output = usefulPrefix + repeatedSentence.repeat(300);
    const repetition = findRepetitiveOutputSuffix(output);

    expect(repetition).toBeDefined();
    const trimmed = trimRepetitiveSuffix(output, repetition!);
    expect(trimmed.startsWith(usefulPrefix)).toBe(true);
    expect(trimmed.length).toBeLessThanOrEqual(usefulPrefix.length + repeatedSentence.length * 2);
    expect(trimmed.length).toBeGreaterThanOrEqual(usefulPrefix.length + repeatedSentence.length);
  });

  it("does not flag varied long-form output", () => {
    const output = Array.from(
      { length: 2000 },
      (_, index) => `Observation ${index}: value ${(index * 7919).toString(36)}.`,
    ).join("\n");

    expect(findRepetitiveOutputSuffix(output)).toBeUndefined();
  });

  it("detects repeated commitment and reconsideration cycles in long reasoning", () => {
    const reasoning = Array.from({ length: 8 }, (_, index) => {
      const variedAnalysis = Array.from(
        { length: 40 },
        (__, detail) => `Invariant ${index}-${detail} uses value ${((index + 1) * (detail + 17)).toString(36)}.`,
      ).join(" ");
      return [
        `Let me implement module ${index} now.`,
        variedAnalysis,
        `Actually, I need to think more carefully about invariant ${index}.`,
        variedAnalysis,
        `Now I will write the code for module ${index}.`,
      ].join("\n\n");
    }).join("\n\n");

    const loop = findReasoningActionLoop(reasoning);

    expect(loop).toBeDefined();
    expect(loop!.start).toBeGreaterThan(0);
    expect(loop!.start).toBeLessThan(reasoning.length / 2);
  });

  it("does not flag long reasoning that keeps making concrete progress", () => {
    const reasoning = Array.from(
      { length: 800 },
      (_, index) =>
        `Observation ${index} verifies invariant ${(index * 7919).toString(36)} against case ${(index * 104729).toString(36)}.`,
    ).join("\n");

    expect(findReasoningActionLoop(reasoning)).toBeUndefined();
  });

  it("does not count action language inside generated code fences", () => {
    const code = Array.from(
      { length: 300 },
      (_, index) =>
        `// Let me implement branch ${index}. Actually, I should think about it. Now I will write the code.\nconst value${index} = ${index};`,
    ).join("\n");
    const reasoning = `Implementation follows:\n\n\`\`\`typescript\n${code}\n\`\`\``;

    expect(findReasoningActionLoop(reasoning)).toBeUndefined();
  });

  it("does not flag a long implementation plan without reconsideration cycles", () => {
    const commitments = Array.from(
      { length: 20 },
      (_, index) =>
        `I will implement module ${index} after verifying requirement ${(index * 1543).toString(36)}. ${"Specific implementation detail. ".repeat(30)}`,
    ).join("\n");

    expect(findReasoningActionLoop(commitments)).toBeUndefined();
  });

  it("requires commitments and reconsiderations to alternate repeatedly", () => {
    const commitments = Array.from(
      { length: 6 },
      (_, index) => `I will implement module ${index}. ${"Concrete implementation detail. ".repeat(50)}`,
    ).join("\n");
    const reconsiderations = Array.from(
      { length: 5 },
      (_, index) => `Actually, constraint ${index} needs review. ${"Independent verification detail. ".repeat(30)}`,
    ).join("\n");

    expect(findReasoningActionLoop(`${commitments}\n${reconsiderations}`)).toBeUndefined();
  });
});
