import { describe, expect, it } from "vitest";
import { sanitizeBinaryOutput } from "../src/utils/shell.ts";

describe("sanitizeBinaryOutput", () => {
  it("filters out control characters and preserves tab/newline/carriage-return", () => {
    const input = "Hello\x00World\tGood\nDay\rTest\x07";
    const output = sanitizeBinaryOutput(input);
    expect(output).toBe("HelloWorld\tGood\nDay\rTest");
  });

  it("filters out lone surrogates (0xD800-0xDFFF)", () => {
    const input = "Valid\uD800Surrogate\uDFFFTest";
    const output = sanitizeBinaryOutput(input);
    expect(output).toBe("ValidSurrogateTest");
  });

  it("filters out DEL and C1 control characters and format characters", () => {
    const input = "Clean\x7FText\x80End\uFFF9Format\uFFFBDone";
    const output = sanitizeBinaryOutput(input);
    expect(output).toBe("CleanTextEndFormatDone");
  });
});
