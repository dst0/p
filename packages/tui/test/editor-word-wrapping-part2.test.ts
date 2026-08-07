import assert from "node:assert";
import { describe, it } from "node:test";
import { wordWrapLine } from "../src/components/editor.ts";
import { visibleWidth } from "../src/utils.ts";

describe("Editor component - Word wrapping (Part 2)", () => {
  it("splits oversized atomic segment across multiple chunks", () => {
    // Simulate a paste marker wider than maxWidth by passing pre-segmented data
    const marker = "[paste #1 +20 lines]"; // 21 chars
    const line = `A${marker}B`;
    const segments: Intl.SegmentData[] = [
      { segment: "A", index: 0, input: line },
      { segment: marker, index: 1, input: line },
      { segment: "B", index: 1 + marker.length, input: line },
    ];

    const chunks = wordWrapLine(line, 10, segments);

    // Every chunk must fit within maxWidth
    for (const chunk of chunks) {
      assert.ok(
        visibleWidth(chunk.text) <= 10,
        `chunk "${chunk.text}" has visible width ${visibleWidth(chunk.text)}, expected <= 10`,
      );
    }

    // Verify no content is lost
    const reconstructed = chunks.map((c) => line.slice(c.startIndex, c.endIndex)).join("");
    assert.strictEqual(reconstructed, line);
  });

  it("splits oversized atomic segment at start of line", () => {
    const marker = "[paste #1 +20 lines]"; // 21 chars
    const line = `${marker}B`;
    const segments: Intl.SegmentData[] = [
      { segment: marker, index: 0, input: line },
      { segment: "B", index: marker.length, input: line },
    ];

    const chunks = wordWrapLine(line, 10, segments);

    for (const chunk of chunks) {
      assert.ok(visibleWidth(chunk.text) <= 10);
    }
    // "B" ends up on the last line (either alone or with the marker tail)
    assert.strictEqual(chunks[chunks.length - 1]!.text.includes("B"), true);

    const reconstructed = chunks.map((c) => line.slice(c.startIndex, c.endIndex)).join("");
    assert.strictEqual(reconstructed, line);
  });

  it("splits oversized atomic segment at end of line", () => {
    const marker = "[paste #1 +20 lines]"; // 21 chars
    const line = `A${marker}`;
    const segments: Intl.SegmentData[] = [
      { segment: "A", index: 0, input: line },
      { segment: marker, index: 1, input: line },
    ];

    const chunks = wordWrapLine(line, 10, segments);

    for (const chunk of chunks) {
      assert.ok(visibleWidth(chunk.text) <= 10);
    }
    assert.strictEqual(chunks[0]!.text, "A");

    const reconstructed = chunks.map((c) => line.slice(c.startIndex, c.endIndex)).join("");
    assert.strictEqual(reconstructed, line);
  });

  it("splits consecutive oversized atomic segments", () => {
    const m1 = "[paste #1 +20 lines]"; // 21 chars
    const m2 = "[paste #2 +30 lines]"; // 21 chars
    const line = `${m1}${m2}`;
    const segments: Intl.SegmentData[] = [
      { segment: m1, index: 0, input: line },
      { segment: m2, index: m1.length, input: line },
    ];

    const chunks = wordWrapLine(line, 10, segments);

    for (const chunk of chunks) {
      assert.ok(
        visibleWidth(chunk.text) <= 10,
        `chunk "${chunk.text}" has visible width ${visibleWidth(chunk.text)}, expected <= 10`,
      );
    }

    const reconstructed = chunks.map((c) => line.slice(c.startIndex, c.endIndex)).join("");
    assert.strictEqual(reconstructed, line);
  });

  it("wraps normally after oversized atomic segment", () => {
    const marker = "[paste #1 +20 lines]"; // 21 chars
    const line = `${marker} hello world`;
    const segments: Intl.SegmentData[] = [
      { segment: marker, index: 0, input: line },
      { segment: " ", index: marker.length, input: line },
      { segment: "h", index: marker.length + 1, input: line },
      { segment: "e", index: marker.length + 2, input: line },
      { segment: "l", index: marker.length + 3, input: line },
      { segment: "l", index: marker.length + 4, input: line },
      { segment: "o", index: marker.length + 5, input: line },
      { segment: " ", index: marker.length + 6, input: line },
      { segment: "w", index: marker.length + 7, input: line },
      { segment: "o", index: marker.length + 8, input: line },
      { segment: "r", index: marker.length + 9, input: line },
      { segment: "l", index: marker.length + 10, input: line },
      { segment: "d", index: marker.length + 11, input: line },
    ];

    const chunks = wordWrapLine(line, 10, segments);

    // All chunks must fit
    for (const chunk of chunks) {
      assert.ok(
        visibleWidth(chunk.text) <= 10,
        `chunk "${chunk.text}" has visible width ${visibleWidth(chunk.text)}, expected <= 10`,
      );
    }

    // Last chunk should contain "world" (normal wrapping resumes)
    assert.strictEqual(chunks[chunks.length - 1]!.text, "world");

    const reconstructed = chunks.map((c) => line.slice(c.startIndex, c.endIndex)).join("");
    assert.strictEqual(reconstructed, line);
  });
});
