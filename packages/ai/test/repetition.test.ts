import { describe, expect, it } from "vitest";
import {
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
});
