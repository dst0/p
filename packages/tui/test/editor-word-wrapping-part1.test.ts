import assert from "node:assert";
import { describe, it } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { Editor, wordWrapLine } from "../src/components/editor.ts";
import { visibleWidth } from "../src/utils.ts";
import { createTestTUI } from "./editor-test-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component - Word wrapping (Part 1)", () => {
  it("wraps at word boundaries instead of mid-word", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    const width = 40;

    editor.setText("Hello world this is a test of word wrapping functionality");
    const lines = editor.render(width);

    // Get content lines (between borders)
    const contentLines = lines.slice(1, -1).map((l) => stripVTControlCharacters(l).trim());

    // Should NOT break mid-word
    // Line 1 should end with a complete word
    assert.ok(!contentLines[0]!.endsWith("-"), "Line should not end with hyphen (mid-word break)");

    // Each content line should be complete words
    for (const line of contentLines) {
      // Words at end of line should be complete (no partial words)
      const lastChar = line.trimEnd().slice(-1);
      assert.ok(lastChar === "" || /[\w.,!?;:]/.test(lastChar), `Line ends unexpectedly with: "${lastChar}"`);
    }
  });

  it("does not start lines with leading whitespace after word wrap", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    const width = 20;

    editor.setText("Word1 Word2 Word3 Word4 Word5 Word6");
    const lines = editor.render(width);

    // Get content lines (between borders)
    const contentLines = lines.slice(1, -1);

    // No line should start with whitespace (except for padding at the end)
    for (let i = 0; i < contentLines.length; i++) {
      const line = stripVTControlCharacters(contentLines[i]!);
      const trimmedStart = line.trimStart();
      // The line should either be all padding or start with a word character
      if (trimmedStart.length > 0) {
        assert.ok(!/^\s+\S/.test(line.trimEnd()), `Line ${i} starts with unexpected whitespace before content`);
      }
    }
  });

  it("breaks long words (URLs) at character level", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    const width = 30;

    editor.setText("Check https://example.com/very/long/path/that/exceeds/width here");
    const lines = editor.render(width);

    // All lines should fit within width
    for (let i = 1; i < lines.length - 1; i++) {
      const lineWidth = visibleWidth(lines[i]!);
      assert.strictEqual(lineWidth, width, `Line ${i} has width ${lineWidth}, expected ${width}`);
    }
  });

  it("preserves multiple spaces within words on same line", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    const width = 50;

    editor.setText("Word1   Word2    Word3");
    const lines = editor.render(width);

    const contentLine = stripVTControlCharacters(lines[1]!).trim();
    // Multiple spaces should be preserved
    assert.ok(contentLine.includes("Word1   Word2"), "Multiple spaces should be preserved");
  });

  it("handles empty string", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    const width = 40;

    editor.setText("");
    const lines = editor.render(width);

    // Should have border + empty content + border
    assert.strictEqual(lines.length, 3);
  });

  it("handles single word that fits exactly", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    const width = 10 + 1; // +1 col reserved for cursor

    editor.setText("1234567890");
    const lines = editor.render(width);

    // Should have exactly 3 lines (top border, content, bottom border)
    assert.strictEqual(lines.length, 3);
    const contentLine = stripVTControlCharacters(lines[1]!);
    assert.ok(contentLine.includes("1234567890"), "Content should contain the word");
  });

  it("wraps word to next line when it ends exactly at terminal width", () => {
    // "hello " (6) + "world" (5) = 11, but "world" is non-whitespace ending at width.
    // Thus, wrap it to next line. The trailing space stays with "hello" on line 1
    const chunks = wordWrapLine("hello world test", 11);

    assert.strictEqual(chunks.length, 2);
    assert.strictEqual(chunks[0]!.text, "hello ");
    assert.strictEqual(chunks[1]!.text, "world test");
  });

  it("keeps whitespace at terminal width boundary on same line", () => {
    // "hello world " is exactly 12 chars (including trailing space)
    // The space at position 12 should stay on the first line
    const chunks = wordWrapLine("hello world test", 12);

    assert.strictEqual(chunks.length, 2);
    assert.strictEqual(chunks[0]!.text, "hello world ");
    assert.strictEqual(chunks[1]!.text, "test");
  });

  it("handles unbreakable word filling width exactly followed by space", () => {
    const chunks = wordWrapLine("aaaaaaaaaaaa aaaa", 12);

    assert.strictEqual(chunks.length, 2);
    assert.strictEqual(chunks[0]!.text, "aaaaaaaaaaaa");
    assert.strictEqual(chunks[1]!.text, " aaaa");
  });

  it("wraps word to next line when it fits width but not remaining space", () => {
    const chunks = wordWrapLine("      aaaaaaaaaaaa", 12);

    assert.strictEqual(chunks.length, 2);
    assert.strictEqual(chunks[0]!.text, "      ");
    assert.strictEqual(chunks[1]!.text, "aaaaaaaaaaaa");
  });

  it("keeps word with multi-space and following word together when they fit", () => {
    const chunks = wordWrapLine("Lorem ipsum dolor sit amet,    consectetur", 30);

    assert.strictEqual(chunks.length, 2);
    assert.strictEqual(chunks[0]!.text, "Lorem ipsum dolor sit ");
    assert.strictEqual(chunks[1]!.text, "amet,    consectetur");
  });

  it("keeps word with multi-space and following word when they fill width exactly", () => {
    const chunks = wordWrapLine("Lorem ipsum dolor sit amet,              consectetur", 30);

    assert.strictEqual(chunks.length, 2);
    assert.strictEqual(chunks[0]!.text, "Lorem ipsum dolor sit ");
    assert.strictEqual(chunks[1]!.text, "amet,              consectetur");
  });

  it("splits when word plus multi-space plus word exceeds width", () => {
    const chunks = wordWrapLine("Lorem ipsum dolor sit amet,               consectetur", 30);

    assert.strictEqual(chunks.length, 3);
    assert.strictEqual(chunks[0]!.text, "Lorem ipsum dolor sit ");
    assert.strictEqual(chunks[1]!.text, "amet,               ");
    assert.strictEqual(chunks[2]!.text, "consectetur");
  });

  it("breaks long whitespace at line boundary", () => {
    const chunks = wordWrapLine("Lorem ipsum dolor sit amet,                         consectetur", 30);

    assert.strictEqual(chunks.length, 3);
    assert.strictEqual(chunks[0]!.text, "Lorem ipsum dolor sit ");
    assert.strictEqual(chunks[1]!.text, "amet,                         ");
    assert.strictEqual(chunks[2]!.text, "consectetur");
  });

  it("breaks long whitespace at line boundary 2", () => {
    const chunks = wordWrapLine("Lorem ipsum dolor sit amet,                          consectetur", 30);

    assert.strictEqual(chunks.length, 3);
    assert.strictEqual(chunks[0]!.text, "Lorem ipsum dolor sit ");
    assert.strictEqual(chunks[1]!.text, "amet,                         ");
    assert.strictEqual(chunks[2]!.text, " consectetur");
  });

  it("breaks whitespace spanning full lines", () => {
    const chunks = wordWrapLine("Lorem ipsum dolor sit amet,                                     consectetur", 30);

    assert.strictEqual(chunks.length, 3);
    assert.strictEqual(chunks[0]!.text, "Lorem ipsum dolor sit ");
    assert.strictEqual(chunks[1]!.text, "amet,                         ");
    assert.strictEqual(chunks[2]!.text, "            consectetur");
  });

  it("force-breaks when wide char after word boundary wrap still overflows", () => {
    // " " (1) + "a"*186 (186) + "你" (2) = 189 visible width
    // maxWidth = 187: backtracking to the space would leave 186 + 2 = 188 > 187,
    // so the algorithm must force-break before the wide char instead.
    const line = ` ${"a".repeat(186)}你`;
    const chunks = wordWrapLine(line, 187);

    for (const chunk of chunks) {
      assert.ok(
        visibleWidth(chunk.text) <= 187,
        `chunk "${chunk.text.slice(0, 20)}..." has visible width ${visibleWidth(chunk.text)}, expected <= 187`,
      );
    }
    // Verify no content is lost
    const reconstructed = chunks.map((c) => line.slice(c.startIndex, c.endIndex)).join("");
    assert.strictEqual(reconstructed, line);
  });
});
