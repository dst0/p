import assert from "node:assert";
import { describe, it } from "node:test";
import { Editor } from "../src/components/editor.ts";
import { createTestTUI } from "./editor-test-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Prompt history navigation", () => {
    it("does nothing on Up arrow when history is empty", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.handleInput("\x1b[A"); // Up arrow

      assert.strictEqual(editor.getText(), "");
    });

    it("shows most recent history entry on Up arrow when editor is empty", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.addToHistory("first prompt");
      editor.addToHistory("second prompt");

      editor.handleInput("\x1b[A"); // Up arrow

      assert.strictEqual(editor.getText(), "second prompt");
    });

    it("cycles through history entries on repeated Up arrow", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.addToHistory("first");
      editor.addToHistory("second");
      editor.addToHistory("third");

      editor.handleInput("\x1b[A"); // Up - shows "third"
      assert.strictEqual(editor.getText(), "third");

      editor.handleInput("\x1b[A"); // Up - shows "second"
      assert.strictEqual(editor.getText(), "second");

      editor.handleInput("\x1b[A"); // Up - shows "first"
      assert.strictEqual(editor.getText(), "first");

      editor.handleInput("\x1b[A"); // Up - stays at "first" (oldest)
      assert.strictEqual(editor.getText(), "first");
    });

    it("restores draft on Down arrow after browsing history", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.addToHistory("prompt");
      editor.setText("draft");
      editor.handleInput("\x1b[D");
      editor.handleInput("\x1b[D");

      editor.handleInput("\x1b[A"); // Up - shows "prompt"
      assert.strictEqual(editor.getText(), "prompt");

      editor.handleInput("\x1b[B"); // Down - restores draft
      assert.strictEqual(editor.getText(), "draft");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 3 });
    });

    it("navigates forward through history with Down arrow", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.addToHistory("first");
      editor.addToHistory("second");
      editor.addToHistory("third");
      editor.setText("draft");

      // Go to oldest
      editor.handleInput("\x1b[A"); // third
      editor.handleInput("\x1b[A"); // second
      editor.handleInput("\x1b[A"); // first

      // Navigate back
      editor.handleInput("\x1b[B"); // second
      assert.strictEqual(editor.getText(), "second");

      editor.handleInput("\x1b[B"); // third
      assert.strictEqual(editor.getText(), "third");

      editor.handleInput("\x1b[B"); // draft
      assert.strictEqual(editor.getText(), "draft");
    });

    it("exits history mode when typing a character", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.addToHistory("old prompt");

      editor.handleInput("\x1b[A"); // Up - shows "old prompt"
      editor.handleInput("x"); // Type a character - exits history mode

      assert.strictEqual(editor.getText(), "xold prompt");
    });

    it("exits history mode on setText", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.addToHistory("first");
      editor.addToHistory("second");

      editor.handleInput("\x1b[A"); // Up - shows "second"
      editor.setText(""); // External clear

      // Up should start fresh from most recent
      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getText(), "second");
    });

    it("does not add empty strings to history", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.addToHistory("");
      editor.addToHistory("   ");
      editor.addToHistory("valid");

      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getText(), "valid");

      // Should not have more entries
      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getText(), "valid");
    });

    it("does not add consecutive duplicates to history", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.addToHistory("same");
      editor.addToHistory("same");
      editor.addToHistory("same");

      editor.handleInput("\x1b[A"); // "same"
      assert.strictEqual(editor.getText(), "same");

      editor.handleInput("\x1b[A"); // stays at "same" (only one entry)
      assert.strictEqual(editor.getText(), "same");
    });

    it("allows non-consecutive duplicates in history", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.addToHistory("first");
      editor.addToHistory("second");
      editor.addToHistory("first"); // Not consecutive, should be added

      editor.handleInput("\x1b[A"); // "first"
      assert.strictEqual(editor.getText(), "first");

      editor.handleInput("\x1b[A"); // "second"
      assert.strictEqual(editor.getText(), "second");

      editor.handleInput("\x1b[A"); // "first" (older one)
      assert.strictEqual(editor.getText(), "first");
    });

    it("uses cursor movement instead of history when editor has content", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.addToHistory("history item");
      editor.setText("line1\nline2");

      // Cursor is at end of line2, Up should move to line1
      editor.handleInput("\x1b[A"); // Up - cursor movement

      // Insert character to verify cursor position
      editor.handleInput("X");

      // X should be inserted in line1, not replace with history
      assert.strictEqual(editor.getText(), "line1X\nline2");
    });

    it("limits history to 100 entries", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      // Add 105 entries
      for (let i = 0; i < 105; i++) {
        editor.addToHistory(`prompt ${i}`);
      }

      // Navigate to oldest
      for (let i = 0; i < 100; i++) {
        editor.handleInput("\x1b[A");
      }

      // Should be at entry 5 (oldest kept), not entry 0
      assert.strictEqual(editor.getText(), "prompt 5");

      // One more Up should not change anything
      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getText(), "prompt 5");
    });

    it("places cursor at start after browsing history upward", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.addToHistory("older entry");
      editor.addToHistory("line1\nline2\nline3");

      editor.handleInput("\x1b[A"); // Up - shows multi-line entry at start
      assert.strictEqual(editor.getText(), "line1\nline2\nline3");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      editor.handleInput("\x1b[A"); // Up again - immediately navigates to older entry
      assert.strictEqual(editor.getText(), "older entry");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });
    });

    it("places cursor at end after browsing history downward", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.addToHistory("older entry");
      editor.addToHistory("line1\nline2\nline3");
      editor.addToHistory("newer entry");

      editor.handleInput("\x1b[A"); // newer entry
      editor.handleInput("\x1b[A"); // multi-line entry
      editor.handleInput("\x1b[A"); // older entry

      editor.handleInput("\x1b[B"); // Down - shows multi-line entry at end
      assert.strictEqual(editor.getText(), "line1\nline2\nline3");
      assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 5 });

      editor.handleInput("\x1b[B"); // Down again - immediately navigates to newer entry
      assert.strictEqual(editor.getText(), "newer entry");
    });

    it("allows opposite-direction cursor movement within multi-line history entry", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.addToHistory("line1\nline2\nline3");

      editor.handleInput("\x1b[A"); // Up - shows entry at start
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      editor.handleInput("\x1b[B"); // Down - cursor moves to line2
      assert.strictEqual(editor.getText(), "line1\nline2\nline3");
      assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 0 });

      editor.handleInput("\x1b[A"); // Up - cursor moves back to line1
      assert.strictEqual(editor.getText(), "line1\nline2\nline3");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });
    });
  });
});
