import assert from "node:assert";
import { describe, it } from "node:test";
import { Editor } from "../src/components/editor.ts";
import { createTestTUI } from "./editor-test-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Character jump (Ctrl+])", () => {
    it("jumps forward to first occurrence of character on same line", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world");
      editor.handleInput("\x01"); // Ctrl+A - go to start
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      editor.handleInput("\x1d"); // Ctrl+] (legacy sequence for ctrl+])
      editor.handleInput("o"); // Jump to first 'o'

      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 4 }); // 'o' in "hello"
    });

    it("jumps forward to next occurrence after cursor", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world");
      editor.handleInput("\x01"); // Ctrl+A - go to start
      // Move cursor to the 'o' in "hello" (col 4)
      for (let i = 0; i < 4; i++) editor.handleInput("\x1b[C");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 4 });

      editor.handleInput("\x1d"); // Ctrl+]
      editor.handleInput("o"); // Jump to next 'o' (in "world")

      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 }); // 'o' in "world"
    });

    it("jumps forward across multiple lines", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("abc\ndef\nghi");
      // Cursor is at end (line 2, col 3). Move to line 0 via up arrows, then Ctrl+A
      editor.handleInput("\x1b[A"); // Up
      editor.handleInput("\x1b[A"); // Up - now on line 0
      editor.handleInput("\x01"); // Ctrl+A - go to start of line
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      editor.handleInput("\x1d"); // Ctrl+]
      editor.handleInput("g"); // Jump to 'g' on line 3

      assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 0 });
    });

    it("jumps backward to first occurrence before cursor on same line", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world");
      // Cursor at end (col 11)
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 11 });

      editor.handleInput("\x1b\x1d"); // Ctrl+Alt+] (ESC followed by Ctrl+])
      editor.handleInput("o"); // Jump to last 'o' before cursor

      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 }); // 'o' in "world"
    });

    it("jumps backward across multiple lines", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("abc\ndef\nghi");
      // Cursor at end of line 3
      assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 3 });

      editor.handleInput("\x1b\x1d"); // Ctrl+Alt+]
      editor.handleInput("a"); // Jump to 'a' on line 1

      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });
    });

    it("does nothing when character is not found (forward)", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world");
      editor.handleInput("\x01"); // Ctrl+A - go to start
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      editor.handleInput("\x1d"); // Ctrl+]
      editor.handleInput("z"); // 'z' doesn't exist

      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 }); // Cursor unchanged
    });

    it("does nothing when character is not found (backward)", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world");
      // Cursor at end
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 11 });

      editor.handleInput("\x1b\x1d"); // Ctrl+Alt+]
      editor.handleInput("z"); // 'z' doesn't exist

      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 11 }); // Cursor unchanged
    });

    it("is case-sensitive", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("Hello World");
      editor.handleInput("\x01"); // Ctrl+A - go to start
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      // Search for lowercase 'h' - should not find it (only 'H' exists)
      editor.handleInput("\x1d"); // Ctrl+]
      editor.handleInput("h");

      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 }); // Cursor unchanged

      // Search for uppercase 'W' - should find it
      editor.handleInput("\x1d"); // Ctrl+]
      editor.handleInput("W");

      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 6 }); // 'W' in "World"
    });

    it("cancels jump mode when Ctrl+] is pressed again", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world");
      editor.handleInput("\x01"); // Ctrl+A - go to start
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      editor.handleInput("\x1d"); // Ctrl+] - enter jump mode
      editor.handleInput("\x1d"); // Ctrl+] again - cancel

      // Type 'o' normally - should insert, not jump
      editor.handleInput("o");
      assert.strictEqual(editor.getText(), "ohello world");
    });

    it("cancels jump mode on Escape and processes the Escape", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world");
      editor.handleInput("\x01"); // Ctrl+A - go to start
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      editor.handleInput("\x1d"); // Ctrl+] - enter jump mode
      editor.handleInput("\x1b"); // Escape - cancel jump mode

      // Cursor should be unchanged (Escape itself doesn't move cursor in editor)
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      // Type 'o' normally - should insert, not jump
      editor.handleInput("o");
      assert.strictEqual(editor.getText(), "ohello world");
    });

    it("cancels backward jump mode when Ctrl+Alt+] is pressed again", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world");
      // Cursor at end
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 11 });

      editor.handleInput("\x1b\x1d"); // Ctrl+Alt+] - enter backward jump mode
      editor.handleInput("\x1b\x1d"); // Ctrl+Alt+] again - cancel

      // Type 'o' normally - should insert, not jump
      editor.handleInput("o");
      assert.strictEqual(editor.getText(), "hello worldo");
    });

    it("searches for special characters", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("foo(bar) = baz;");
      editor.handleInput("\x01"); // Ctrl+A - go to start
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      // Jump to '('
      editor.handleInput("\x1d"); // Ctrl+]
      editor.handleInput("(");

      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 3 });

      // Jump to '='
      editor.handleInput("\x1d"); // Ctrl+]
      editor.handleInput("=");

      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 9 });
    });

    it("handles empty text gracefully", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      editor.handleInput("\x1d"); // Ctrl+]
      editor.handleInput("x");

      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 }); // Cursor unchanged
    });

    it("resets lastAction when jumping", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world");
      editor.handleInput("\x01"); // Ctrl+A - go to start

      // Type to set lastAction to "type-word"
      editor.handleInput("x");
      assert.strictEqual(editor.getText(), "xhello world");

      // Jump forward
      editor.handleInput("\x1d"); // Ctrl+]
      editor.handleInput("o");

      // Type more - should start a new undo unit (lastAction was reset)
      editor.handleInput("Y");
      assert.strictEqual(editor.getText(), "xhellYo world");

      // Undo should only undo "Y", not "x" as well
      editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
      assert.strictEqual(editor.getText(), "xhello world");
    });
  });
});
