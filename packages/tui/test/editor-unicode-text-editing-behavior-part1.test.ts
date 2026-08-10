import assert from "node:assert";
import { describe, it } from "node:test";
import { Editor } from "../src/components/editor.ts";
import { createTestTUI } from "./editor-test-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component - Unicode text editing behavior (Part 1)", () => {
  it("inserts mixed ASCII, umlauts, and emojis as literal text", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.handleInput("H");
    editor.handleInput("e");
    editor.handleInput("l");
    editor.handleInput("l");
    editor.handleInput("o");
    editor.handleInput(" ");
    editor.handleInput("ä");
    editor.handleInput("ö");
    editor.handleInput("ü");
    editor.handleInput(" ");
    editor.handleInput("😀");

    const text = editor.getText();
    assert.strictEqual(text, "Hello äöü 😀");
  });

  it("deletes single-code-unit unicode characters (umlauts) with Backspace", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.handleInput("ä");
    editor.handleInput("ö");
    editor.handleInput("ü");

    // Delete the last character (ü)
    editor.handleInput("\x7f"); // Backspace

    const text = editor.getText();
    assert.strictEqual(text, "äö");
  });

  it("deletes multi-code-unit emojis with single Backspace", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.handleInput("😀");
    editor.handleInput("👍");

    // Delete the last emoji (👍) - single backspace deletes whole grapheme cluster
    editor.handleInput("\x7f"); // Backspace

    const text = editor.getText();
    assert.strictEqual(text, "😀");
  });

  it("inserts characters at the correct position after cursor movement over umlauts", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.handleInput("ä");
    editor.handleInput("ö");
    editor.handleInput("ü");

    // Move cursor left twice
    editor.handleInput("\x1b[D"); // Left arrow
    editor.handleInput("\x1b[D"); // Left arrow

    // Insert 'x' in the middle
    editor.handleInput("x");

    const text = editor.getText();
    assert.strictEqual(text, "äxöü");
  });

  it("moves cursor across multi-code-unit emojis with single arrow key", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.handleInput("😀");
    editor.handleInput("👍");
    editor.handleInput("🎉");

    // Move cursor left over last emoji (🎉) - single arrow moves over whole grapheme
    editor.handleInput("\x1b[D"); // Left arrow

    // Move cursor left over second emoji (👍)
    editor.handleInput("\x1b[D");

    // Insert 'x' between first and second emoji
    editor.handleInput("x");

    const text = editor.getText();
    assert.strictEqual(text, "😀x👍🎉");
  });

  it("preserves umlauts across line breaks", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.handleInput("ä");
    editor.handleInput("ö");
    editor.handleInput("ü");
    editor.handleInput("\n"); // new line
    editor.handleInput("Ä");
    editor.handleInput("Ö");
    editor.handleInput("Ü");

    const text = editor.getText();
    assert.strictEqual(text, "äöü\nÄÖÜ");
  });

  it("replaces the entire document with unicode text via setText (paste simulation)", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    // Simulate bracketed paste / programmatic replacement
    editor.setText("Hällö Wörld! 😀 äöüÄÖÜß");

    const text = editor.getText();
    assert.strictEqual(text, "Hällö Wörld! 😀 äöüÄÖÜß");
  });

  it("moves cursor to document start on Ctrl+A and inserts at the beginning", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.handleInput("a");
    editor.handleInput("b");
    editor.handleInput("\x01"); // Ctrl+A (move to start)
    editor.handleInput("x"); // Insert at start

    const text = editor.getText();
    assert.strictEqual(text, "xab");
  });

  it("deletes words correctly with Ctrl+W and Alt+Backspace", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    // Basic word deletion
    editor.setText("foo bar baz");
    editor.handleInput("\x17"); // Ctrl+W
    assert.strictEqual(editor.getText(), "foo bar ");

    // Trailing whitespace
    editor.setText("foo bar   ");
    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "foo ");

    // Punctuation run
    editor.setText("foo bar...");
    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "foo bar");

    // ASCII punctuation inside Intl word-like segments preserves old boundaries
    editor.setText("foo.bar");
    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "foo.");

    editor.setText("foo:bar");
    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "foo:");

    // Delete across multiple lines
    editor.setText("line one\nline two");
    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "line one\nline ");

    // Delete empty line (merge)
    editor.setText("line one\n");
    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "line one");

    // Grapheme safety (emoji as a word)
    editor.setText("foo 😀😀 bar");
    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "foo 😀😀 ");
    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "foo ");

    // Alt+Backspace
    editor.setText("foo bar");
    editor.handleInput("\x1b\x7f"); // Alt+Backspace (legacy)
    assert.strictEqual(editor.getText(), "foo ");
  });
});
