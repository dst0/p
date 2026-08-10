import assert from "node:assert";
import { describe, it } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { Editor } from "../src/components/editor.ts";
import { visibleWidth } from "../src/utils.ts";
import { createTestTUI } from "./editor-test-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Grapheme-aware text wrapping", () => {
    it("wraps lines correctly when text contains wide emojis", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      const width = 20;

      // ✅ is 2 columns wide, so "Hello ✅ World" is 14 columns
      editor.setText("Hello ✅ World");
      const lines = editor.render(width);

      // All content lines (between borders) should fit within width
      for (let i = 1; i < lines.length - 1; i++) {
        const lineWidth = visibleWidth(lines[i]!);
        assert.strictEqual(lineWidth, width, `Line ${i} has width ${lineWidth}, expected ${width}`);
      }
    });

    it("wraps long text with emojis at correct positions", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      const width = 10;

      // Each ✅ is 2 columns. "✅✅✅✅✅" = 10 columns, fits exactly
      // "✅✅✅✅✅✅" = 12 columns, needs wrap
      editor.setText("✅✅✅✅✅✅");
      const lines = editor.render(width);

      // Should have 2 content lines (plus 2 border lines)
      // First line: 5 emojis (10 cols), second line: 1 emoji (2 cols) + padding
      for (let i = 1; i < lines.length - 1; i++) {
        const lineWidth = visibleWidth(lines[i]!);
        assert.strictEqual(lineWidth, width, `Line ${i} has width ${lineWidth}, expected ${width}`);
      }
    });

    it("renders isolated Thai and Lao AM clusters without width drift", () => {
      for (const text of ["ำabc", "ຳabc"]) {
        const editor = new Editor(createTestTUI(), defaultEditorTheme);
        const width = 8;
        editor.setText(text);

        for (const line of editor.render(width)) {
          assert.strictEqual(visibleWidth(line), width, `line width drift for ${JSON.stringify(text)}: ${line}`);
        }
      }
    });

    it("wraps CJK characters correctly (each is 2 columns wide)", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      const width = 10 + 1; // +1 col reserved for cursor

      // Each CJK char is 2 columns. "日本語テスト" = 6 chars = 12 columns
      editor.setText("日本語テスト");
      const lines = editor.render(width);

      for (let i = 1; i < lines.length - 1; i++) {
        const lineWidth = visibleWidth(lines[i]!);
        assert.strictEqual(lineWidth, width, `Line ${i} has width ${lineWidth}, expected ${width}`);
      }

      // Verify content split correctly
      const contentLines = lines.slice(1, -1).map((l) => stripVTControlCharacters(l).trim());
      assert.strictEqual(contentLines.length, 2);
      assert.strictEqual(contentLines[0], "日本語テス"); // 5 chars = 10 columns
      assert.strictEqual(contentLines[1], "ト"); // 1 char = 2 columns (+ padding)
    });

    it("handles mixed ASCII and wide characters in wrapping", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      const width = 15 + 1; // +1 col reserved for cursor

      // "Test ✅ OK 日本" = 4 + 1 + 2 + 1 + 2 + 1 + 4 = 15 columns (fits in width-1=15)
      editor.setText("Test ✅ OK 日本");
      const lines = editor.render(width);

      // Should fit in one content line
      const contentLines = lines.slice(1, -1);
      assert.strictEqual(contentLines.length, 1);

      const lineWidth = visibleWidth(contentLines[0]!);
      assert.strictEqual(lineWidth, width);
    });

    it("renders cursor correctly on wide characters", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      const width = 20;

      editor.setText("A✅B");
      // Cursor should be at end (after B)
      const lines = editor.render(width);

      // The cursor (reverse video space) should be visible
      const contentLine = lines[1]!;
      assert.ok(contentLine.includes("\x1b[7m"), "Should have reverse video cursor");

      // Line should still be correct width
      assert.strictEqual(visibleWidth(contentLine), width);
    });

    it("does not exceed terminal width with emoji at wrap boundary", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      const width = 11;

      // "0123456789✅" = 10 ASCII + 2-wide emoji = 12 columns
      // Should wrap before the emoji since it would exceed width
      editor.setText("0123456789✅");
      const lines = editor.render(width);

      for (let i = 1; i < lines.length - 1; i++) {
        const lineWidth = visibleWidth(lines[i]!);
        assert.ok(lineWidth <= width, `Line ${i} has width ${lineWidth}, exceeds max ${width}`);
      }
    });

    it("shows cursor at end of line before wrap, wraps on next char", () => {
      const width = 10;
      for (const paddingX of [0, 1]) {
        const editor = new Editor(createTestTUI(width + paddingX), defaultEditorTheme, { paddingX });

        // Type 9 chars → fills layoutWidth exactly, cursor at end on same line
        for (const ch of "aaaaaaaaa") editor.handleInput(ch);
        let lines = editor.render(width + paddingX);
        let contentLines = lines.slice(1, -1);
        assert.strictEqual(contentLines.length, 1, "Should be 1 content line before wrap");
        assert.ok(contentLines[0]!.endsWith("\x1b[7m \x1b[0m"), "Cursor should be at end of line");

        // Type 1 more → text wraps to second line
        editor.handleInput("a");
        lines = editor.render(width + paddingX);
        contentLines = lines.slice(1, -1);
        assert.strictEqual(contentLines.length, 2, "Should wrap to 2 content lines");
      }
    });
  });
});
