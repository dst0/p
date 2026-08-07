import assert from "node:assert";
import { describe, it } from "node:test";
import { Editor } from "../src/components/editor.ts";
import { createTestTUI } from "./editor-test-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component - Kill ring (Part 1)", () => {
  it("Ctrl+W saves deleted text to kill ring and Ctrl+Y yanks it", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("foo bar baz");
    editor.handleInput("\x17"); // Ctrl+W - deletes "baz"
    assert.strictEqual(editor.getText(), "foo bar ");

    // Move to beginning and yank
    editor.handleInput("\x01"); // Ctrl+A
    editor.handleInput("\x19"); // Ctrl+Y
    assert.strictEqual(editor.getText(), "bazfoo bar ");
  });

  it("Ctrl+U saves deleted text to kill ring", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("hello world");
    // Move cursor to middle
    editor.handleInput("\x01"); // Ctrl+A (start)
    editor.handleInput("\x1b[C"); // Right 5 times
    editor.handleInput("\x1b[C");
    editor.handleInput("\x1b[C");
    editor.handleInput("\x1b[C");
    editor.handleInput("\x1b[C");
    editor.handleInput("\x1b[C"); // After "hello "

    editor.handleInput("\x15"); // Ctrl+U - deletes "hello "
    assert.strictEqual(editor.getText(), "world");

    editor.handleInput("\x19"); // Ctrl+Y
    assert.strictEqual(editor.getText(), "hello world");
  });

  it("Ctrl+K saves deleted text to kill ring", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("hello world");
    editor.handleInput("\x01"); // Ctrl+A (start)
    editor.handleInput("\x0b"); // Ctrl+K - deletes "hello world"

    assert.strictEqual(editor.getText(), "");

    editor.handleInput("\x19"); // Ctrl+Y
    assert.strictEqual(editor.getText(), "hello world");
  });

  it("Ctrl+Y does nothing when kill ring is empty", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("test");
    editor.handleInput("\x19"); // Ctrl+Y
    assert.strictEqual(editor.getText(), "test");
  });

  it("Alt+Y cycles through kill ring after Ctrl+Y", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    // Create kill ring with multiple entries
    editor.setText("first");
    editor.handleInput("\x17"); // Ctrl+W - deletes "first"
    editor.setText("second");
    editor.handleInput("\x17"); // Ctrl+W - deletes "second"
    editor.setText("third");
    editor.handleInput("\x17"); // Ctrl+W - deletes "third"

    // Kill ring now has: [first, second, third]
    assert.strictEqual(editor.getText(), "");

    editor.handleInput("\x19"); // Ctrl+Y - yanks "third" (most recent)
    assert.strictEqual(editor.getText(), "third");

    editor.handleInput("\x1by"); // Alt+Y - cycles to "second"
    assert.strictEqual(editor.getText(), "second");

    editor.handleInput("\x1by"); // Alt+Y - cycles to "first"
    assert.strictEqual(editor.getText(), "first");

    editor.handleInput("\x1by"); // Alt+Y - cycles back to "third"
    assert.strictEqual(editor.getText(), "third");
  });

  it("Alt+Y does nothing if not preceded by yank", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("test");
    editor.handleInput("\x17"); // Ctrl+W - deletes "test"
    editor.setText("other");

    // Type something to break the yank chain
    editor.handleInput("x");
    assert.strictEqual(editor.getText(), "otherx");

    // Alt+Y should do nothing
    editor.handleInput("\x1by"); // Alt+Y
    assert.strictEqual(editor.getText(), "otherx");
  });

  it("Alt+Y does nothing if kill ring has ≤1 entry", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("only");
    editor.handleInput("\x17"); // Ctrl+W - deletes "only"

    editor.handleInput("\x19"); // Ctrl+Y - yanks "only"
    assert.strictEqual(editor.getText(), "only");

    editor.handleInput("\x1by"); // Alt+Y - should do nothing (only 1 entry)
    assert.strictEqual(editor.getText(), "only");
  });

  it("consecutive Ctrl+W accumulates into one kill ring entry", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("one two three");
    editor.handleInput("\x17"); // Ctrl+W - deletes "three"
    editor.handleInput("\x17"); // Ctrl+W - deletes "two " (prepended)
    editor.handleInput("\x17"); // Ctrl+W - deletes "one " (prepended)

    assert.strictEqual(editor.getText(), "");

    // Should be one combined entry
    editor.handleInput("\x19"); // Ctrl+Y
    assert.strictEqual(editor.getText(), "one two three");
  });

  it("Ctrl+U accumulates multiline deletes including newlines", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    // Start with multiline text, cursor at end
    editor.setText("line1\nline2\nline3");
    // Cursor is at end of line3 (line 2, col 5)

    // Delete "line3"
    editor.handleInput("\x15"); // Ctrl+U
    assert.strictEqual(editor.getText(), "line1\nline2\n");

    // Delete newline (at start of empty line 2, merges with line1)
    editor.handleInput("\x15"); // Ctrl+U
    assert.strictEqual(editor.getText(), "line1\nline2");

    // Delete "line2"
    editor.handleInput("\x15"); // Ctrl+U
    assert.strictEqual(editor.getText(), "line1\n");

    // Delete newline
    editor.handleInput("\x15"); // Ctrl+U
    assert.strictEqual(editor.getText(), "line1");

    // Delete "line1"
    editor.handleInput("\x15"); // Ctrl+U
    assert.strictEqual(editor.getText(), "");

    // All deletions accumulated into one entry: "line1\nline2\nline3"
    editor.handleInput("\x19"); // Ctrl+Y
    assert.strictEqual(editor.getText(), "line1\nline2\nline3");
  });

  it("backward deletions prepend, forward deletions append during accumulation", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("prefix|suffix");
    // Position cursor at |
    editor.handleInput("\x01"); // Ctrl+A
    for (let i = 0; i < 6; i++) editor.handleInput("\x1b[C"); // Move right 6 times

    editor.handleInput("\x0b"); // Ctrl+K - deletes "suffix" (forward)
    editor.handleInput("\x0b"); // Ctrl+K - deletes "|" (forward, appended)
    assert.strictEqual(editor.getText(), "prefix");

    editor.handleInput("\x19"); // Ctrl+Y
    assert.strictEqual(editor.getText(), "prefix|suffix");
  });

  it("non-delete actions break kill accumulation", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    // Delete "baz", then type "x" to break accumulation, then delete "x"
    editor.setText("foo bar baz");
    editor.handleInput("\x17"); // Ctrl+W - deletes "baz"
    assert.strictEqual(editor.getText(), "foo bar ");

    editor.handleInput("x"); // Typing breaks accumulation
    assert.strictEqual(editor.getText(), "foo bar x");

    editor.handleInput("\x17"); // Ctrl+W - deletes "x" (separate entry, not accumulated)
    assert.strictEqual(editor.getText(), "foo bar ");

    // Yank most recent - should be "x", not "xbaz"
    editor.handleInput("\x19"); // Ctrl+Y
    assert.strictEqual(editor.getText(), "foo bar x");

    // Cycle to previous - should be "baz" (separate entry)
    editor.handleInput("\x1by"); // Alt+Y
    assert.strictEqual(editor.getText(), "foo bar baz");
  });
});
