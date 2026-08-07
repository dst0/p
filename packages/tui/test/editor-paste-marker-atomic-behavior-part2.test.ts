import assert from "node:assert";
import { describe, it } from "node:test";
import { Editor } from "../src/components/editor.ts";
import { visibleWidth } from "../src/utils.ts";
import { createTestTUI } from "./editor-test-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component - Paste marker atomic behavior (Part 2)", () => {
  it("does not crash when text + paste marker exceeds terminal width with cursor on marker", () => {
    // Reproduce: terminal width 54, text "b".repeat(35) + "[paste #1 +27 lines]" + "bbbb"
    // Cursor lands on the paste marker after word-wrap, causing the rendered line
    // to be 55 visible chars (1 over the width).
    const tui = createTestTUI();
    const editor = new Editor(tui, defaultEditorTheme);

    // Type 35 'b' characters
    for (let i = 0; i < 35; i++) editor.handleInput("b");

    // Paste 27 lines
    const bigContent = "line\n".repeat(27).trimEnd();
    editor.handleInput(`\x1b[200~${bigContent}\x1b[201~`);

    // Type a few more characters
    for (let i = 0; i < 4; i++) editor.handleInput("b");

    // Move cursor left to land on the paste marker
    editor.handleInput("\x1b[D"); // past last 'b'
    editor.handleInput("\x1b[D"); // past last 'b'
    editor.handleInput("\x1b[D"); // past last 'b'
    editor.handleInput("\x1b[D"); // past last 'b'
    editor.handleInput("\x1b[D"); // now on the paste marker

    // Render at width 54 - should not throw
    const renderWidth = 54;
    const lines = editor.render(renderWidth);
    for (const line of lines) {
      assert.ok(
        visibleWidth(line) <= renderWidth,
        `line exceeds width ${renderWidth}: visible=${visibleWidth(line)} text=${JSON.stringify(line)}`,
      );
    }
  });

  it("wordWrapLine re-checks overflow after backtracking to wrap opportunity", () => {
    // Reproduce crash #2: " " + "b".repeat(35) + atomic_marker(20 chars) + "bbbb"
    // layoutWidth=53. After wrapping at the space, the remaining 35 b's + marker = 55
    // must trigger a second force-break instead of silently overflowing.
    const tui = createTestTUI();
    const editor = new Editor(tui, defaultEditorTheme);

    // Type a space, then 35 b's
    editor.handleInput(" ");
    for (let i = 0; i < 35; i++) editor.handleInput("b");

    // Paste 27 lines to create marker
    const bigContent = "line\n".repeat(27).trimEnd();
    editor.handleInput(`\x1b[200~${bigContent}\x1b[201~`);

    // Type trailing chars
    for (let i = 0; i < 4; i++) editor.handleInput("b");

    // Render at width 54 (contentWidth=54, layoutWidth=53 with paddingX=0)
    const renderWidth = 54;
    const lines = editor.render(renderWidth);
    for (const line of lines) {
      assert.ok(
        visibleWidth(line) <= renderWidth,
        `line exceeds width ${renderWidth}: visible=${visibleWidth(line)} text=${JSON.stringify(line)}`,
      );
    }
  });

  it("expands large pasted content literally in getExpandedText", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    const pastedText = [
      "line 1",
      "line 2",
      "line 3",
      "line 4",
      "line 5",
      "line 6",
      "line 7",
      "line 8",
      "line 9",
      "line 10",
      "tokens $1 $2 $& $$ $` $' end",
    ].join("\n");

    editor.handleInput(`\x1b[200~${pastedText}\x1b[201~`);

    assert.match(editor.getText(), /\[paste #\d+ \+\d+ lines\]/);
    assert.strictEqual(editor.getExpandedText(), pastedText);
  });

  it("snaps to the paste marker start when navigating down into it", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    // Line 0: long enough text to establish a sticky column
    editor.setText("12345678901234567890\n\nhello ");

    // Create a large paste to get a marker
    const bigContent = "x".repeat(2000);
    editor.handleInput(`\x1b[200~${bigContent}\x1b[201~`);
    editor.render(80);

    const text = editor.getText();
    const _marker = text.match(/\[paste #\d+ \d+ chars\]/)![0];
    // Line 0: "12345678901234567890"
    // Line 1: "" (empty)
    // Line 2: "hello [paste #1 2000 chars]"
    //         marker starts at col 6

    // Navigate to line 0, col 10
    editor.handleInput("\x1b[A"); // Up to line 1
    editor.handleInput("\x1b[A"); // Up to line 0
    editor.handleInput("\x01"); // Ctrl+A (start of line)
    for (let i = 0; i < 10; i++) editor.handleInput("\x1b[C"); // Right 10
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 10 });

    // Down to empty line
    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 0 });

    // Down to paste marker line - sticky col 10 falls inside marker (starts at col 6).
    // Cursor should snap to start of marker (col 6), not end (col 6 + marker.length).
    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 6 });
  });

  it("preserves sticky column when navigating through paste marker line", () => {
    const tui = createTestTUI(30, 24);
    const editor = new Editor(tui, defaultEditorTheme);

    // Build:
    // Line 0: "1234567890123456" (16 chars)
    // Line 1: "" (empty)
    // Line 2: "[paste #1 2000 chars]" (22 chars, paste marker)
    // Line 3: "" (empty)
    // Line 4: "abcdefghijklmnop" (16 chars)
    for (const ch of "1234567890123456") editor.handleInput(ch);
    editor.handleInput("\n");
    editor.handleInput("\n");
    editor.handleInput(`\x1b[200~${"x".repeat(2000)}\x1b[201~`);
    editor.handleInput("\n");
    editor.handleInput("\n");
    for (const ch of "abcdefghijklmnop") editor.handleInput(ch);
    editor.render(30);

    // Navigate to line 0, col 10
    for (let i = 0; i < 4; i++) editor.handleInput("\x1b[A"); // Up to line 0
    editor.handleInput("\x01"); // Ctrl+A
    for (let i = 0; i < 10; i++) editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 10 });

    // Down to empty line - sticky col 10 established
    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 0 });

    // Down to paste marker - cursor snapped to col 0 (start of marker)
    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 0 });

    // Down to empty line
    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 3, col: 0 });

    // Down to last line - should restore sticky col 10
    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 4, col: 10 });
  });
});
