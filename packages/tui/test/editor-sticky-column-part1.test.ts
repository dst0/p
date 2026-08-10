import assert from "node:assert";
import { describe, it } from "node:test";
import { Editor } from "../src/components/editor.ts";
import { createTestTUI } from "./editor-test-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component - Sticky column (Part 1)", () => {
  function _positionCursor(editor: Editor, line: number, col: number): void {
    // Go to line 0 first
    for (let i = 0; i < 20; i++) editor.handleInput("\x1b[A");
    // Go to target line
    for (let i = 0; i < line; i++) editor.handleInput("\x1b[B");
    // Go to target col
    editor.handleInput("\x01"); // Ctrl+A
    for (let i = 0; i < col; i++) editor.handleInput("\x1b[C");
  }

  it("preserves target column when moving up through a shorter line", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    // Line 0: "2222222222x222" (x at col 10)
    // Line 1: "" (empty)
    // Line 2: "1111111111_111111111111" (_ at col 10)
    editor.setText("2222222222x222\n\n1111111111_111111111111");

    // Position cursor on _ (line 2, col 10)
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 23 }); // At end
    editor.handleInput("\x01"); // Ctrl+A - go to start of line
    for (let i = 0; i < 10; i++) editor.handleInput("\x1b[C"); // Move right to col 10
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 10 });

    // Press Up - should move to empty line (col clamped to 0)
    editor.handleInput("\x1b[A"); // Up arrow
    assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 0 });

    // Press Up again - should move to line 0 at col 10 (on 'x')
    editor.handleInput("\x1b[A"); // Up arrow
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 10 });
  });

  it("preserves target column when moving down through a shorter line", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("1111111111_111\n\n2222222222x222222222222");

    // Position cursor on _ (line 0, col 10)
    editor.handleInput("\x1b[A"); // Up to line 1
    editor.handleInput("\x1b[A"); // Up to line 0
    editor.handleInput("\x01"); // Ctrl+A
    for (let i = 0; i < 10; i++) editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 10 });

    // Press Down - should move to empty line (col clamped to 0)
    editor.handleInput("\x1b[B"); // Down arrow
    assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 0 });

    // Press Down again - should move to line 2 at col 10 (on 'x')
    editor.handleInput("\x1b[B"); // Down arrow
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 10 });
  });

  it("resets sticky column on horizontal movement (left arrow)", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("1234567890\n\n1234567890");

    // Start at line 2, col 5
    editor.handleInput("\x01"); // Ctrl+A
    for (let i = 0; i < 5; i++) editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 5 });

    // Move up through empty line
    editor.handleInput("\x1b[A"); // Up - line 1, col 0
    editor.handleInput("\x1b[A"); // Up - line 0, col 5 (sticky)
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 5 });

    // Move left - resets sticky column
    editor.handleInput("\x1b[D"); // Left
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 4 });

    // Move down twice
    editor.handleInput("\x1b[B"); // Down - line 1, col 0
    editor.handleInput("\x1b[B"); // Down - line 2, col 4 (new sticky from col 4)
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 4 });
  });

  it("resets sticky column on horizontal movement (right arrow)", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("1234567890\n\n1234567890");

    // Start at line 0, col 5
    editor.handleInput("\x1b[A"); // Up to line 1
    editor.handleInput("\x1b[A"); // Up to line 0
    editor.handleInput("\x01"); // Ctrl+A
    for (let i = 0; i < 5; i++) editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 5 });

    // Move down through empty line
    editor.handleInput("\x1b[B"); // Down - line 1, col 0
    editor.handleInput("\x1b[B"); // Down - line 2, col 5 (sticky)
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 5 });

    // Move right - resets sticky column
    editor.handleInput("\x1b[C"); // Right
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 6 });

    // Move up twice
    editor.handleInput("\x1b[A"); // Up - line 1, col 0
    editor.handleInput("\x1b[A"); // Up - line 0, col 6 (new sticky from col 6)
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 6 });
  });

  it("resets sticky column on typing", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("1234567890\n\n1234567890");

    // Start at line 2, col 8
    editor.handleInput("\x01"); // Ctrl+A
    for (let i = 0; i < 8; i++) editor.handleInput("\x1b[C");

    // Move up through empty line
    editor.handleInput("\x1b[A"); // Up
    editor.handleInput("\x1b[A"); // Up - line 0, col 8
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 8 });

    // Type a character - resets sticky column
    editor.handleInput("X");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 9 });

    // Move down twice
    editor.handleInput("\x1b[B"); // Down - line 1, col 0
    editor.handleInput("\x1b[B"); // Down - line 2, col 9 (new sticky from col 9)
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 9 });
  });

  it("resets sticky column on backspace", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("1234567890\n\n1234567890");

    // Start at line 2, col 8
    editor.handleInput("\x01"); // Ctrl+A
    for (let i = 0; i < 8; i++) editor.handleInput("\x1b[C");

    // Move up through empty line
    editor.handleInput("\x1b[A"); // Up
    editor.handleInput("\x1b[A"); // Up - line 0, col 8
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 8 });

    // Backspace - resets sticky column
    editor.handleInput("\x7f"); // Backspace
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 });

    // Move down twice
    editor.handleInput("\x1b[B"); // Down - line 1, col 0
    editor.handleInput("\x1b[B"); // Down - line 2, col 7 (new sticky from col 7)
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 7 });
  });

  it("resets sticky column on Ctrl+A (move to line start)", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("1234567890\n\n1234567890");

    // Start at line 2, col 8
    editor.handleInput("\x01"); // Ctrl+A
    for (let i = 0; i < 8; i++) editor.handleInput("\x1b[C");

    // Move up - establishes sticky col 8
    editor.handleInput("\x1b[A"); // Up - line 1, col 0

    // Ctrl+A - resets sticky column to 0
    editor.handleInput("\x01"); // Ctrl+A
    assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 0 });

    // Move up
    editor.handleInput("\x1b[A"); // Up - line 0, col 0 (new sticky from col 0)
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });
  });

  it("resets sticky column on Ctrl+E (move to line end)", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("12345\n\n1234567890");

    // Start at line 2, col 3
    editor.handleInput("\x01"); // Ctrl+A
    for (let i = 0; i < 3; i++) editor.handleInput("\x1b[C");

    // Move up through empty line - establishes sticky col 3
    editor.handleInput("\x1b[A"); // Up - line 1, col 0
    editor.handleInput("\x1b[A"); // Up - line 0, col 3
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 3 });

    // Ctrl+E - resets sticky column to end
    editor.handleInput("\x05"); // Ctrl+E
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 5 });

    // Move down twice
    editor.handleInput("\x1b[B"); // Down - line 1, col 0
    editor.handleInput("\x1b[B"); // Down - line 2, col 5 (new sticky from col 5)
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 5 });
  });
});
