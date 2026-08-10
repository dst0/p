import assert from "node:assert";
import { describe, it } from "node:test";
import { Editor } from "../src/components/editor.ts";
import { createTestTUI, positionCursor } from "./editor-test-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component - Sticky column (Part 3)", () => {
  it("handles editor resizes when preferredVisualCol is on the same line", () => {
    // Create editor with wider terminal
    const tui = createTestTUI(80, 24);
    const editor = new Editor(tui, defaultEditorTheme);

    editor.setText("12345678901234567890\n\n12345678901234567890");

    // Start at line 2, col 15
    editor.handleInput("\x01"); // Ctrl+A
    for (let i = 0; i < 15; i++) editor.handleInput("\x1b[C");

    // Move up through empty line - establishes sticky col 15
    editor.handleInput("\x1b[A"); // Up
    editor.handleInput("\x1b[A"); // Up - line 0, col 15
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 15 });

    // Render with narrower width to simulate resize
    editor.render(12); // Width 12

    // Move down - sticky should be clamped to new width
    editor.handleInput("\x1b[B"); // Down - line 1
    editor.handleInput("\x1b[B"); // Down - line 2, col should be clamped
    assert.equal(editor.getCursor().col, 4);
  });

  it("handles editor resizes when preferredVisualCol is on a different line", () => {
    const tui = createTestTUI(80, 24);
    const editor = new Editor(tui, defaultEditorTheme);

    // Create a line that wraps into multiple visual lines at width 10
    // "12345678901234567890" = 20 chars, wraps to 2 visual lines at width 10
    editor.setText("short\n12345678901234567890");

    // Go to line 1, col 15
    editor.handleInput("\x01"); // Ctrl+A
    for (let i = 0; i < 15; i++) editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 15 });

    // Move up to establish sticky col 15
    editor.handleInput("\x1b[A"); // Up to line 0
    // Line 0 has only 5 chars, so cursor at col 5
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 5 });

    // Narrow the editor
    editor.render(10);

    // Move down - preferredVisualCol was 15, but width is 10
    // Should land on line 1, clamped to width (visual col 9, which is logical col 9)
    editor.handleInput("\x1b[B"); // Down to line 1
    assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 8 });

    // Move up
    editor.handleInput("\x1b[A"); // Up - should go to line 0
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 5 }); // Line 0 only has 5 chars

    // Restore the original width
    editor.render(80);

    // Move down - preferredVisualCol was kept at 15
    editor.handleInput("\x1b[B"); // Down to line 1
    assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 15 });
  });

  it("rewrapped lines: target fits current visual column", () => {
    const tui = createTestTUI(80, 24);
    const editor = new Editor(tui, defaultEditorTheme);
    editor.setText("abcdefghijklmnopqr\n123456789012345678");

    positionCursor(editor, 0, 18);
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 18 });

    // Narrow to width 10 (layoutWidth = 9).
    // Line 0 last segment has visual col max 9, line 1 first segment max 8
    editor.render(10);

    // Move down: cursor clamps to 8
    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 8 });

    // Widen back. Move up, the current visual col wins
    editor.render(80);
    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 8 });

    // Preferred was cleared by the rewrapped branch
    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 8 });
  });

  it("rewrapped lines: target shorter than current visual column", () => {
    const tui = createTestTUI(80, 24);
    const editor = new Editor(tui, defaultEditorTheme);
    editor.setText("abcdefghijklmnopqr\n123456789012345678\nab");

    positionCursor(editor, 0, 18);
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 18 });

    // Narrow to width 10 (layoutWidth = 9). Moving down clamps to col 8
    editor.render(10);
    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 8 });

    // Widen the editor
    editor.render(80);

    // Move down to short line "ab".
    // preferredVisualCol is replaced with current visual col (8), cursor clamps to 2
    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 2 });

    // Moving up restores to preferred col 8
    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 8 });
  });
});
