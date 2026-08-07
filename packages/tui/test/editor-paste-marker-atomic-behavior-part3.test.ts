import assert from "node:assert";
import { describe, it } from "node:test";
import { Editor } from "../src/components/editor.ts";
import { createTestTUI } from "./editor-test-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component - Paste marker atomic behavior (Part 3)", () => {
  it("does not get stuck moving down from a multi-visual-line paste marker", () => {
    const tui = createTestTUI(20, 24);
    const editor = new Editor(tui, defaultEditorTheme);

    // Build:
    // Logical line 0: "abcdefgh" + marker(21 chars) + "ijklmnopqr"
    // Logical line 1: "123456789012345678"
    //
    // Marker "[paste #1 +100 lines]" (21 chars) is wider than the
    // terminal (20). Word-wrap splits at the space before "lines",
    // producing:
    //   VL1: abcdefgh              (startCol 0,  len 8)
    //   VL2: [paste #1 +100        (startCol 8,  len 15) <- marker head
    //   VL3: lines]ijklmnopqr      (startCol 23, len 16) <- marker tail + content
    //   VL4: 123456789012345678    (line 1)
    //
    // On VL3 the marker tail "lines]" occupies visual cols 0-5.
    // Content ("i") starts at visual col 6 = logical col 29.
    for (const ch of "abcdefgh") editor.handleInput(ch);
    const bigContent = "line\n".repeat(100).trimEnd();
    editor.handleInput(`\x1b[200~${bigContent}\x1b[201~`);
    for (const ch of "ijklmnopqr") editor.handleInput(ch);
    editor.handleInput("\n");
    for (const ch of "123456789012345678") editor.handleInput(ch);
    editor.render(20);

    const text = editor.getText();
    const markerMatch = text.match(/\[paste #\d+ \+\d+ lines]/);
    assert.ok(markerMatch, "paste marker should be created");
    const markerLen = markerMatch[0].length; // 21
    assert.ok(markerLen > 20, "marker should be wider than terminal");
    const markerStart = 8;
    const markerEnd = markerStart + markerLen; // 29

    // Navigate to line 0, col 6 (on "g"). Preferred col 6 is past the
    // marker tail on VL3, so the cursor should land on content ("i" at
    // col 29) without snapping back.
    editor.handleInput("\x1b[A"); // Up to line 0
    editor.handleInput("\x01"); // Ctrl+A (start of line)
    for (let i = 0; i < 6; i++) editor.handleInput("\x1b[C"); // Right to col 6
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 6 });

    // Down: cursor lands on paste marker start
    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: markerStart });

    // Down again: preferred col 6 lands at VL3 col 29 ("i"), which is
    // past the marker. Cursor stays on line 0.
    editor.handleInput("\x1b[B");
    assert.strictEqual(editor.getCursor().line, 0);
    assert.strictEqual(editor.getCursor().col, markerEnd); // col 29 = "i"

    // Up: back to paste marker
    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: markerStart });

    // Up again: back to col 6 ("g")
    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 6 });
  });

  it("skips marker continuation VLs when preferred col falls in marker tail", () => {
    const tui = createTestTUI(20, 24);
    const editor = new Editor(tui, defaultEditorTheme);

    // Same layout. Start at col 3 ("d"). Preferred col 3 maps to VL3
    // visual col 3 which is inside the "lines]" marker tail.
    // moveToVisualLine detects the continuation VL and skips to VL4
    // (line 1).
    //   VL1: abcdefgh              (startCol 0,  len 8)
    //   VL2: [paste #1 +100        (startCol 8,  len 15) <- marker head
    //   VL3: lines]ijklmnopqr      (startCol 23, len 16) <- marker tail + content
    //   VL4: 123456789012345678    (line 1)
    for (const ch of "abcdefgh") editor.handleInput(ch);
    const bigContent = "line\n".repeat(100).trimEnd();
    editor.handleInput(`\x1b[200~${bigContent}\x1b[201~`);
    for (const ch of "ijklmnopqr") editor.handleInput(ch);
    editor.handleInput("\n");
    for (const ch of "123456789012345678") editor.handleInput(ch);
    editor.render(20);

    // Navigate to line 0, col 3 (on "d")
    editor.handleInput("\x1b[A"); // Up to line 0
    editor.handleInput("\x01"); // Ctrl+A
    for (let i = 0; i < 3; i++) editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 3 });

    // Down: marker
    editor.handleInput("\x1b[B");
    assert.strictEqual(editor.getCursor().col, 8);

    // Down: skips VL3 (col 3 in marker tail) and lands on line 1
    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 3 });

    // Round-trip back
    editor.handleInput("\x1b[A");
    assert.strictEqual(editor.getCursor().col, 8); // marker
    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 3 });
  });

  it("submits large pasted content literally", () => {
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
    let submitted = "";
    editor.onSubmit = (text) => {
      submitted = text;
    };

    editor.handleInput(`\x1b[200~${pastedText}\x1b[201~`);
    editor.handleInput("\r");

    assert.strictEqual(submitted, pastedText);
  });
});
