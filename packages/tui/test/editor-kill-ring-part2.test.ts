import assert from "node:assert";
import { describe, it } from "node:test";
import { Editor } from "../src/components/editor.ts";
import { createTestTUI } from "./editor-test-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component - Kill ring (Part 2)", () => {
  it("non-yank actions break Alt+Y chain", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("first");
    editor.handleInput("\x17"); // Ctrl+W
    editor.setText("second");
    editor.handleInput("\x17"); // Ctrl+W
    editor.setText("");

    editor.handleInput("\x19"); // Ctrl+Y - yanks "second"
    assert.strictEqual(editor.getText(), "second");

    editor.handleInput("x"); // Type breaks yank chain
    assert.strictEqual(editor.getText(), "secondx");

    editor.handleInput("\x1by"); // Alt+Y - should do nothing
    assert.strictEqual(editor.getText(), "secondx");
  });

  it("kill ring rotation persists after cycling", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("first");
    editor.handleInput("\x17"); // deletes "first"
    editor.setText("second");
    editor.handleInput("\x17"); // deletes "second"
    editor.setText("third");
    editor.handleInput("\x17"); // deletes "third"
    editor.setText("");

    // Ring: [first, second, third]

    editor.handleInput("\x19"); // Ctrl+Y - yanks "third"
    editor.handleInput("\x1by"); // Alt+Y - cycles to "second", ring rotates

    // Now ring is: [third, first, second]
    assert.strictEqual(editor.getText(), "second");

    // Do something else
    editor.handleInput("x");
    editor.setText("");

    // New yank should get "second" (now at end after rotation)
    editor.handleInput("\x19"); // Ctrl+Y
    assert.strictEqual(editor.getText(), "second");
  });

  it("consecutive deletions across lines coalesce into one entry", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    // "1\n2\n3" with cursor at end, delete everything with Ctrl+W
    editor.setText("1\n2\n3");
    editor.handleInput("\x17"); // Ctrl+W - deletes "3"
    assert.strictEqual(editor.getText(), "1\n2\n");

    editor.handleInput("\x17"); // Ctrl+W - deletes newline (merge with prev line)
    assert.strictEqual(editor.getText(), "1\n2");

    editor.handleInput("\x17"); // Ctrl+W - deletes "2"
    assert.strictEqual(editor.getText(), "1\n");

    editor.handleInput("\x17"); // Ctrl+W - deletes newline
    assert.strictEqual(editor.getText(), "1");

    editor.handleInput("\x17"); // Ctrl+W - deletes "1"
    assert.strictEqual(editor.getText(), "");

    // All deletions should have accumulated into one entry
    editor.handleInput("\x19"); // Ctrl+Y
    assert.strictEqual(editor.getText(), "1\n2\n3");
  });

  it("Ctrl+K at line end deletes newline and coalesces", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    // "ab" on line 1, "cd" on line 2, cursor at end of line 1
    editor.setText("");
    editor.handleInput("a");
    editor.handleInput("b");
    editor.handleInput("\n");
    editor.handleInput("c");
    editor.handleInput("d");
    // Move to end of first line
    editor.handleInput("\x1b[A"); // Up arrow
    editor.handleInput("\x05"); // Ctrl+E - end of line

    // Now at end of "ab", Ctrl+K should delete newline (merge with "cd")
    editor.handleInput("\x0b"); // Ctrl+K - deletes newline
    assert.strictEqual(editor.getText(), "abcd");

    // Continue deleting
    editor.handleInput("\x0b"); // Ctrl+K - deletes "cd"
    assert.strictEqual(editor.getText(), "ab");

    // Both deletions should accumulate
    editor.handleInput("\x19"); // Ctrl+Y
    assert.strictEqual(editor.getText(), "ab\ncd");
  });

  it("handles yank in middle of text", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("word");
    editor.handleInput("\x17"); // Ctrl+W - deletes "word"
    editor.setText("hello world");

    // Move to middle (after "hello ")
    editor.handleInput("\x01"); // Ctrl+A
    for (let i = 0; i < 6; i++) editor.handleInput("\x1b[C");

    editor.handleInput("\x19"); // Ctrl+Y
    assert.strictEqual(editor.getText(), "hello wordworld");
  });

  it("handles yank-pop in middle of text", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    // Create two kill ring entries
    editor.setText("FIRST");
    editor.handleInput("\x17"); // Ctrl+W - deletes "FIRST"
    editor.setText("SECOND");
    editor.handleInput("\x17"); // Ctrl+W - deletes "SECOND"

    // Ring: ["FIRST", "SECOND"]

    // Set up "hello world" and position cursor after "hello "
    editor.setText("hello world");
    editor.handleInput("\x01"); // Ctrl+A - go to start of line
    for (let i = 0; i < 6; i++) editor.handleInput("\x1b[C"); // Move right 6

    // Yank "SECOND" in the middle
    editor.handleInput("\x19"); // Ctrl+Y
    assert.strictEqual(editor.getText(), "hello SECONDworld");

    // Yank-pop replaces "SECOND" with "FIRST"
    editor.handleInput("\x1by"); // Alt+Y
    assert.strictEqual(editor.getText(), "hello FIRSTworld");
  });

  it("multiline yank and yank-pop in middle of text", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    // Create single-line entry
    editor.setText("SINGLE");
    editor.handleInput("\x17"); // Ctrl+W - deletes "SINGLE"

    // Create multiline entry via consecutive Ctrl+U
    editor.setText("A\nB");
    editor.handleInput("\x15"); // Ctrl+U - deletes "B"
    editor.handleInput("\x15"); // Ctrl+U - deletes newline
    editor.handleInput("\x15"); // Ctrl+U - deletes "A"
    // Ring: ["SINGLE", "A\nB"]

    // Insert in middle of "hello world"
    editor.setText("hello world");
    editor.handleInput("\x01"); // Ctrl+A
    for (let i = 0; i < 6; i++) editor.handleInput("\x1b[C");

    // Yank multiline "A\nB"
    editor.handleInput("\x19"); // Ctrl+Y
    assert.strictEqual(editor.getText(), "hello A\nBworld");

    // Yank-pop replaces with "SINGLE"
    editor.handleInput("\x1by"); // Alt+Y
    assert.strictEqual(editor.getText(), "hello SINGLEworld");
  });

  it("Alt+D deletes word forward and saves to kill ring", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("hello world test");
    editor.handleInput("\x01"); // Ctrl+A - go to start

    editor.handleInput("\x1bd"); // Alt+D - deletes "hello"
    assert.strictEqual(editor.getText(), " world test");

    editor.handleInput("\x1bd"); // Alt+D - deletes " world" (skips whitespace, then word)
    assert.strictEqual(editor.getText(), " test");

    // Yank should get accumulated text
    editor.handleInput("\x19"); // Ctrl+Y
    assert.strictEqual(editor.getText(), "hello world test");
  });

  it("Alt+D at end of line deletes newline", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("line1\nline2");
    // Move to start of document, then to end of first line
    editor.handleInput("\x1b[A"); // Up arrow - go to first line
    editor.handleInput("\x05"); // Ctrl+E - end of line

    editor.handleInput("\x1bd"); // Alt+D - deletes newline (merges lines)
    assert.strictEqual(editor.getText(), "line1line2");

    editor.handleInput("\x19"); // Ctrl+Y
    assert.strictEqual(editor.getText(), "line1\nline2");
  });
});
