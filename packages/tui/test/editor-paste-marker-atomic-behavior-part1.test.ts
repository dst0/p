import assert from "node:assert";
import { describe, it } from "node:test";
import { Editor } from "../src/components/editor.ts";
import { visibleWidth } from "../src/utils.ts";
import { createTestTUI } from "./editor-test-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component - Paste marker atomic behavior (Part 1)", () => {
  function pasteWithMarker(editor: Editor): string {
    const bigContent = "line\n".repeat(20).trimEnd(); // 20 lines
    editor.handleInput(`\x1b[200~${bigContent}\x1b[201~`);
    // The editor replaces large pastes with a marker like "[paste #1 +20 lines]"
    return editor.getText();
  }

  it("creates a paste marker for large pastes", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    const text = pasteWithMarker(editor);
    assert.match(text, /\[paste #\d+ \+\d+ lines\]/);
  });

  it("treats paste marker as single unit for right arrow", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    editor.handleInput("A");
    pasteWithMarker(editor);
    editor.handleInput("B");
    // Text: "A[paste #1 +20 lines]B", cursor at end

    // Go to start
    editor.handleInput("\x01"); // Ctrl+A
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

    // Right arrow: should move past "A"
    editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 1 });

    // Right arrow: should skip the entire marker
    editor.handleInput("\x1b[C");
    const marker = editor.getText().match(/\[paste #\d+ \+\d+ lines\]/)![0];
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 1 + marker.length });

    // Right arrow: should move past "B"
    editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 1 + marker.length + 1 });
  });

  it("treats paste marker as single unit for left arrow", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    editor.handleInput("A");
    pasteWithMarker(editor);
    editor.handleInput("B");
    // Cursor at end

    // Left arrow: past "B"
    editor.handleInput("\x1b[D");
    const text = editor.getText();
    const marker = text.match(/\[paste #\d+ \+\d+ lines\]/)![0];
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 1 + marker.length });

    // Left arrow: skip the entire marker
    editor.handleInput("\x1b[D");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 1 });

    // Left arrow: past "A"
    editor.handleInput("\x1b[D");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });
  });

  it("treats paste marker as single unit for backspace", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    editor.handleInput("A");
    pasteWithMarker(editor);
    editor.handleInput("B");

    const text = editor.getText();
    const marker = text.match(/\[paste #\d+ \+\d+ lines\]/)![0];

    // Position cursor right after the marker (before "B")
    editor.handleInput("\x01"); // Ctrl+A
    // Move past "A" and the marker
    editor.handleInput("\x1b[C"); // past "A"
    editor.handleInput("\x1b[C"); // past marker
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 1 + marker.length });

    // Backspace: should delete the entire marker at once
    editor.handleInput("\x7f");
    assert.strictEqual(editor.getText(), "AB");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 1 });
  });

  it("treats paste marker as single unit for forward delete", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    editor.handleInput("A");
    pasteWithMarker(editor);
    editor.handleInput("B");

    // Position cursor on "A" (col 0) then move right once to be just before marker
    editor.handleInput("\x01"); // Ctrl+A
    editor.handleInput("\x1b[C"); // past "A", now at col 1 (start of marker)

    // Forward delete: should delete the entire marker at once
    editor.handleInput("\x1b[3~"); // Delete key
    assert.strictEqual(editor.getText(), "AB");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 1 });
  });

  it("treats paste marker as single unit for word movement", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    editor.handleInput("X");
    editor.handleInput(" ");
    pasteWithMarker(editor);
    editor.handleInput(" ");
    editor.handleInput("Y");
    // Text: "X [paste #1 +20 lines] Y"

    const text = editor.getText();
    const marker = text.match(/\[paste #\d+ \+\d+ lines\]/)![0];

    // Go to start
    editor.handleInput("\x01"); // Ctrl+A

    // Ctrl+Right: skip "X"
    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 1 });

    // Ctrl+Right: skip whitespace + marker (marker treated as single non-ws, non-punct unit)
    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 2 + marker.length });
  });

  it("undo restores marker after backspace deletion", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    editor.handleInput("A");
    pasteWithMarker(editor);
    editor.handleInput("B");

    const textBefore = editor.getText();

    // Position after marker
    editor.handleInput("\x01");
    editor.handleInput("\x1b[C"); // past A
    editor.handleInput("\x1b[C"); // past marker

    // Delete marker
    editor.handleInput("\x7f");
    assert.strictEqual(editor.getText(), "AB");

    // Undo
    editor.handleInput("\x1b[45;5u");
    assert.strictEqual(editor.getText(), textBefore);
  });

  it("handles multiple paste markers in same line", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    pasteWithMarker(editor);
    editor.handleInput(" ");
    pasteWithMarker(editor);

    const text = editor.getText();
    const markers = [...text.matchAll(/\[paste #\d+ \+\d+ lines\]/g)];
    assert.strictEqual(markers.length, 2);

    // Go to start
    editor.handleInput("\x01");

    // Right arrow: should skip first marker atomically
    editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: markers[0]![0].length });

    // Right arrow: past space
    editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: markers[0]![0].length + 1 });

    // Right arrow: should skip second marker atomically
    editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), {
      line: 0,
      col: markers[0]![0].length + 1 + markers[1]![0].length,
    });
  });

  it("does not treat manually typed marker-like text as atomic (no valid paste ID)", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    // Type text that matches the pattern but was typed manually (no paste entry)
    const fakeMarker = "[paste #99 +5 lines]";
    for (const ch of fakeMarker) editor.handleInput(ch);

    assert.strictEqual(editor.getText(), fakeMarker);

    // No paste with ID 99 exists, so the marker is NOT treated atomically.
    // Right arrow should move one grapheme at a time.
    editor.handleInput("\x01"); // Ctrl+A
    editor.handleInput("\x1b[C"); // Right
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 1 }); // Just past "["
  });

  it("does not crash when paste marker is wider than terminal width", () => {
    // Reproduce: terminal width 8, paste marker "[paste #1 +47 lines]" (21 chars)
    const tui = createTestTUI();
    const editor = new Editor(tui, defaultEditorTheme);
    const bigContent = "line\n".repeat(47).trimEnd();
    editor.handleInput(`\x1b[200~${bigContent}\x1b[201~`);

    const text = editor.getText();
    const marker = text.match(/\[paste #\d+ \+\d+ lines\]/);
    assert.ok(marker, "paste marker should be created");
    assert.ok(visibleWidth(marker[0]) > 8, "marker should be wider than render width");

    // Render at very narrow width - should not throw
    const lines = editor.render(8);
    // Every rendered line must fit within the width (marker is split)
    for (const line of lines) {
      assert.ok(
        visibleWidth(line) <= 8,
        `line exceeds width 8: visible=${visibleWidth(line)} text=${JSON.stringify(line)}`,
      );
    }
  });
});
