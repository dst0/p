import assert from "node:assert";
import { describe, it } from "node:test";
import { Editor } from "../src/components/editor.ts";
import { createTestTUI } from "./editor-test-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor prompt history reuse edge cases", () => {
  it("does nothing on Down before history browsing starts", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    editor.addToHistory("previous");
    editor.setText("draft");

    editor.handleInput("\x1b[B");

    assert.strictEqual(editor.getText(), "draft");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 5 });
  });

  it("restores an edited draft after revisiting history", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    editor.addToHistory("previous");
    editor.handleInput("\x1b[A");
    editor.handleInput("X");
    assert.strictEqual(editor.getText(), "Xprevious");

    editor.handleInput("\x1b[A");
    assert.strictEqual(editor.getText(), "previous");
    editor.handleInput("\x1b[B");

    assert.strictEqual(editor.getText(), "Xprevious");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 1 });
  });

  it("reuses a recalled prompt again after resubmitting it", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    const submissions: string[] = [];
    editor.onSubmit = (text) => {
      submissions.push(text);
      editor.addToHistory(text);
    };
    editor.setText("repeat me");
    editor.handleInput("\r");

    editor.handleInput("\x1b[A");
    assert.strictEqual(editor.getText(), "repeat me");
    editor.handleInput("\r");
    editor.handleInput("\x1b[A");

    assert.deepStrictEqual(submissions, ["repeat me", "repeat me"]);
    assert.strictEqual(editor.getText(), "repeat me");
    assert.strictEqual(editor.history.length, 1);
  });

  it("preserves multiline prompts exactly across Up and Down traversal", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    editor.addToHistory("older\nwith blank\n\nline");
    editor.addToHistory("newer\nsecond line");
    editor.setText("draft\ncontinued");

    editor.handleInput("\x1b[A"); // Move from the second draft line to the first.
    editor.handleInput("\x1b[A"); // Enter history from the first visual line.
    assert.strictEqual(editor.getText(), "newer\nsecond line");
    editor.handleInput("\x1b[A");
    assert.strictEqual(editor.getText(), "older\nwith blank\n\nline");
    for (let line = 0; line < 4; line++) editor.handleInput("\x1b[B");
    assert.strictEqual(editor.getText(), "newer\nsecond line");
    editor.handleInput("\x1b[B");

    assert.strictEqual(editor.getText(), "draft\ncontinued");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 5 });
  });

  it("edits a recalled multiline prompt with Shift+Enter without changing stored history", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    editor.addToHistory("first\nsecond");
    editor.handleInput("\x1b[A");

    editor.handleInput("\x1b[13;2u");
    editor.handleInput("inserted");
    assert.strictEqual(editor.getText(), "\ninsertedfirst\nsecond");

    editor.handleInput("\x1b[A");
    editor.handleInput("\x1b[A");
    editor.handleInput("\x1b[A");
    assert.strictEqual(editor.getText(), "first\nsecond");
  });

  it("moves through a wrapped draft before entering prompt history", () => {
    const editor = new Editor(createTestTUI(8), defaultEditorTheme);
    editor.addToHistory("history");
    editor.setText("wrapped text");
    editor.render(8);

    editor.handleInput("\x1b[A");

    assert.strictEqual(editor.getText(), "wrapped text");
    assert.notDeepStrictEqual(editor.getCursor(), { line: 0, col: 0 });
  });

  it("keeps slash commands and their arguments as opaque history entries", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    editor.addToHistory("/model provider/model");
    editor.addToHistory("/compact --dry-run preserve this context");

    editor.handleInput("\x1b[A");
    assert.strictEqual(editor.getText(), "/compact --dry-run preserve this context");
    editor.handleInput("\x1b[A");

    assert.strictEqual(editor.getText(), "/model provider/model");
  });
});
