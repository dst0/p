import assert from "node:assert";
import { describe, it } from "node:test";
import { Editor } from "../src/components/editor.ts";
import { createTestTUI } from "./editor-test-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component - Sticky column (Part 2)", () => {
  it("resets sticky column on word movement (Ctrl+Left)", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("hello world\n\nhello world");

    // Start at end of line 2 (col 11)
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 11 });

    // Move up through empty line - establishes sticky col 11
    editor.handleInput("\x1b[A"); // Up - line 1, col 0
    editor.handleInput("\x1b[A"); // Up - line 0, col 11
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 11 });

    // Ctrl+Left - word movement resets sticky column
    editor.handleInput("\x1b[1;5D"); // Ctrl+Left
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 6 }); // Before "world"

    // Move down twice
    editor.handleInput("\x1b[B"); // Down - line 1, col 0
    editor.handleInput("\x1b[B"); // Down - line 2, col 6 (new sticky from col 6)
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 6 });
  });

  it("resets sticky column on word movement (Ctrl+Right)", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("hello world\n\nhello world");

    // Start at line 0, col 0
    editor.handleInput("\x1b[A"); // Up
    editor.handleInput("\x1b[A"); // Up
    editor.handleInput("\x01"); // Ctrl+A
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

    // Move down through empty line - establishes sticky col 0
    editor.handleInput("\x1b[B"); // Down - line 1, col 0
    editor.handleInput("\x1b[B"); // Down - line 2, col 0
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 0 });

    // Ctrl+Right - word movement resets sticky column
    editor.handleInput("\x1b[1;5C"); // Ctrl+Right
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 5 }); // After "hello"

    // Move up twice
    editor.handleInput("\x1b[A"); // Up - line 1, col 0
    editor.handleInput("\x1b[A"); // Up - line 0, col 5 (new sticky from col 5)
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 5 });
  });

  it("resets sticky column on undo", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("1234567890\n\n1234567890");

    // Go to line 0, col 8
    editor.handleInput("\x1b[A"); // Up to line 1
    editor.handleInput("\x1b[A"); // Up to line 0
    editor.handleInput("\x01"); // Ctrl+A
    for (let i = 0; i < 8; i++) editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 8 });

    // Move down through empty line - establishes sticky col 8
    editor.handleInput("\x1b[B"); // Down - line 1, col 0
    editor.handleInput("\x1b[B"); // Down - line 2, col 8 (sticky)
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 8 });

    // Type something to create undo state - this clears sticky and sets col to 9
    editor.handleInput("X");
    assert.strictEqual(editor.getText(), "1234567890\n\n12345678X90");
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 9 });

    // Move up - establishes new sticky col 9
    editor.handleInput("\x1b[A"); // Up - line 1, col 0
    editor.handleInput("\x1b[A"); // Up - line 0, col 9
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 9 });

    // Undo - resets sticky column and restores cursor to line 2, col 8
    editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
    assert.strictEqual(editor.getText(), "1234567890\n\n1234567890");
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 8 });

    // Move up - should capture new sticky from restored col 8, not old col 9
    editor.handleInput("\x1b[A"); // Up - line 1, col 0
    editor.handleInput("\x1b[A"); // Up - line 0, col 8 (new sticky from restored position)
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 8 });
  });

  it("handles multiple consecutive up/down movements", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("1234567890\nab\ncd\nef\n1234567890");

    // Start at line 4, col 7
    editor.handleInput("\x01"); // Ctrl+A
    for (let i = 0; i < 7; i++) editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), { line: 4, col: 7 });

    // Move up multiple times through short lines
    editor.handleInput("\x1b[A"); // Up - line 3, col 2 (clamped)
    editor.handleInput("\x1b[A"); // Up - line 2, col 2 (clamped)
    editor.handleInput("\x1b[A"); // Up - line 1, col 2 (clamped)
    editor.handleInput("\x1b[A"); // Up - line 0, col 7 (restored)
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 });

    // Move down multiple times - sticky should still be 7
    editor.handleInput("\x1b[B"); // Down - line 1, col 2
    editor.handleInput("\x1b[B"); // Down - line 2, col 2
    editor.handleInput("\x1b[B"); // Down - line 3, col 2
    editor.handleInput("\x1b[B"); // Down - line 4, col 7 (restored)
    assert.deepStrictEqual(editor.getCursor(), { line: 4, col: 7 });
  });

  it("moves correctly through wrapped visual lines without getting stuck", () => {
    const tui = createTestTUI(15, 24); // Narrow terminal
    const editor = new Editor(tui, defaultEditorTheme);

    // Line 0: short
    // Line 1: 30 chars = wraps to 3 visual lines at width 10 (after padding)
    editor.setText("short\n123456789012345678901234567890");
    editor.render(15); // This gives 14 layout width

    // Position at end of line 1 (col 30)
    assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 30 });

    // Move up repeatedly - should traverse all visual lines of the wrapped text
    // and eventually reach line 0
    editor.handleInput("\x1b[A"); // Up - to previous visual line within line 1
    assert.strictEqual(editor.getCursor().line, 1);

    editor.handleInput("\x1b[A"); // Up - another visual line
    assert.strictEqual(editor.getCursor().line, 1);

    editor.handleInput("\x1b[A"); // Up - should reach line 0
    assert.strictEqual(editor.getCursor().line, 0);
  });

  it("handles setText resetting sticky column", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("1234567890\n\n1234567890");

    // Establish sticky column
    editor.handleInput("\x01"); // Ctrl+A
    for (let i = 0; i < 8; i++) editor.handleInput("\x1b[C");
    editor.handleInput("\x1b[A"); // Up

    // setText should reset sticky column
    editor.setText("abcdefghij\n\nabcdefghij");
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 10 }); // At end

    // Move up - should capture new sticky from current position (10)
    editor.handleInput("\x1b[A"); // Up - line 1, col 0
    editor.handleInput("\x1b[A"); // Up - line 0, col 10
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 10 });
  });

  it("sets preferredVisualCol when pressing right at end of prompt (last line)", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    // Line 0: 20 chars with 'x' at col 10
    // Line 1: empty
    // Line 2: 10 chars ending with '_'
    editor.setText("111111111x1111111111\n\n333333333_");

    // Go to line 0, press Ctrl+E (end of line) - col 20
    editor.handleInput("\x1b[A"); // Up to line 1
    editor.handleInput("\x1b[A"); // Up to line 0
    editor.handleInput("\x05"); // Ctrl+E - move to end of line
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 20 });

    // Move down to line 2 - cursor clamped to col 10 (end of line)
    editor.handleInput("\x1b[B"); // Down to line 1, col 0
    editor.handleInput("\x1b[B"); // Down to line 2, col 10 (clamped)
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 10 });

    // Press Right at end of prompt - nothing visible happens, but sets preferredVisualCol to 10
    editor.handleInput("\x1b[C"); // Right - can't move, but sets preferredVisualCol
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 10 }); // Still at same position

    // Move up twice to line 0 - should use preferredVisualCol (10) to land on 'x'
    editor.handleInput("\x1b[A"); // Up to line 1, col 0
    editor.handleInput("\x1b[A"); // Up to line 0, col 10 (on 'x')
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 10 });
  });
});
