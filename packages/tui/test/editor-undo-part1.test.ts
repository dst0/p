import assert from "node:assert";
import { describe, it } from "node:test";
import { Editor } from "../src/components/editor.ts";
import { createTestTUI } from "./editor-test-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component - Undo (Part 1)", () => {
  it("does nothing when undo stack is empty", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
    assert.strictEqual(editor.getText(), "");
  });

  it("coalesces consecutive word characters into one undo unit", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.handleInput("h");
    editor.handleInput("e");
    editor.handleInput("l");
    editor.handleInput("l");
    editor.handleInput("o");
    editor.handleInput(" ");
    editor.handleInput("w");
    editor.handleInput("o");
    editor.handleInput("r");
    editor.handleInput("l");
    editor.handleInput("d");
    assert.strictEqual(editor.getText(), "hello world");

    // Undo removes " world" (space captured state before it, so we restore to "hello")
    editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
    assert.strictEqual(editor.getText(), "hello");

    // Undo removes "hello"
    editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
    assert.strictEqual(editor.getText(), "");
  });

  it("undoes spaces one at a time", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.handleInput("h");
    editor.handleInput("e");
    editor.handleInput("l");
    editor.handleInput("l");
    editor.handleInput("o");
    editor.handleInput(" ");
    editor.handleInput(" ");
    assert.strictEqual(editor.getText(), "hello  ");

    editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo) - removes second " "
    assert.strictEqual(editor.getText(), "hello ");

    editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo) - removes first " "
    assert.strictEqual(editor.getText(), "hello");

    editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo) - removes "hello"
    assert.strictEqual(editor.getText(), "");
  });

  it("undoes newlines and signals next word to capture state", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.handleInput("h");
    editor.handleInput("e");
    editor.handleInput("l");
    editor.handleInput("l");
    editor.handleInput("o");
    editor.handleInput("\n");
    editor.handleInput("w");
    editor.handleInput("o");
    editor.handleInput("r");
    editor.handleInput("l");
    editor.handleInput("d");
    assert.strictEqual(editor.getText(), "hello\nworld");

    editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
    assert.strictEqual(editor.getText(), "hello\n");

    editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
    assert.strictEqual(editor.getText(), "hello");

    editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
    assert.strictEqual(editor.getText(), "");
  });

  it("undoes backspace", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.handleInput("h");
    editor.handleInput("e");
    editor.handleInput("l");
    editor.handleInput("l");
    editor.handleInput("o");
    editor.handleInput("\x7f"); // Backspace
    assert.strictEqual(editor.getText(), "hell");

    editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
    assert.strictEqual(editor.getText(), "hello");
  });

  it("undoes forward delete", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.handleInput("h");
    editor.handleInput("e");
    editor.handleInput("l");
    editor.handleInput("l");
    editor.handleInput("o");
    editor.handleInput("\x01"); // Ctrl+A - go to start
    editor.handleInput("\x1b[C"); // Right arrow
    editor.handleInput("\x1b[3~"); // Delete key
    assert.strictEqual(editor.getText(), "hllo");

    editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
    assert.strictEqual(editor.getText(), "hello");
  });

  it("undoes Ctrl+W (delete word backward)", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.handleInput("h");
    editor.handleInput("e");
    editor.handleInput("l");
    editor.handleInput("l");
    editor.handleInput("o");
    editor.handleInput(" ");
    editor.handleInput("w");
    editor.handleInput("o");
    editor.handleInput("r");
    editor.handleInput("l");
    editor.handleInput("d");
    assert.strictEqual(editor.getText(), "hello world");

    editor.handleInput("\x17"); // Ctrl+W
    assert.strictEqual(editor.getText(), "hello ");

    editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
    assert.strictEqual(editor.getText(), "hello world");
  });

  it("undoes Ctrl+K (delete to line end)", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.handleInput("h");
    editor.handleInput("e");
    editor.handleInput("l");
    editor.handleInput("l");
    editor.handleInput("o");
    editor.handleInput(" ");
    editor.handleInput("w");
    editor.handleInput("o");
    editor.handleInput("r");
    editor.handleInput("l");
    editor.handleInput("d");
    editor.handleInput("\x01"); // Ctrl+A - go to start
    for (let i = 0; i < 6; i++) editor.handleInput("\x1b[C"); // Move right 6 times

    editor.handleInput("\x0b"); // Ctrl+K
    assert.strictEqual(editor.getText(), "hello ");

    editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
    assert.strictEqual(editor.getText(), "hello world");

    editor.handleInput("|");
    assert.strictEqual(editor.getText(), "hello |world");
  });

  it("undoes Ctrl+U (delete to line start)", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.handleInput("h");
    editor.handleInput("e");
    editor.handleInput("l");
    editor.handleInput("l");
    editor.handleInput("o");
    editor.handleInput(" ");
    editor.handleInput("w");
    editor.handleInput("o");
    editor.handleInput("r");
    editor.handleInput("l");
    editor.handleInput("d");
    editor.handleInput("\x01"); // Ctrl+A - go to start
    for (let i = 0; i < 6; i++) editor.handleInput("\x1b[C"); // Move right 6 times

    editor.handleInput("\x15"); // Ctrl+U
    assert.strictEqual(editor.getText(), "world");

    editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
    assert.strictEqual(editor.getText(), "hello world");
  });

  it("undoes yank", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.handleInput("h");
    editor.handleInput("e");
    editor.handleInput("l");
    editor.handleInput("l");
    editor.handleInput("o");
    editor.handleInput(" ");
    editor.handleInput("\x17"); // Ctrl+W - delete "hello "
    editor.handleInput("\x19"); // Ctrl+Y - yank
    assert.strictEqual(editor.getText(), "hello ");

    editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
    assert.strictEqual(editor.getText(), "");
  });
});
