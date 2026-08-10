import assert from "node:assert";
import { describe, it } from "node:test";
import { Editor } from "../src/components/editor.ts";
import { createTestTUI } from "./editor-test-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

const multilineKeySequences = [
  ["Kitty/CSI-u", "\x1b[13;2u"],
  ["xterm modifyOtherKeys", "\x1b[27;2;13~"],
  ["legacy mapped Escape+Return", "\x1b\r"],
  ["legacy CSI fallback", "\x1b[13;2~"],
  ["Ghostty linefeed mapping", "\n"],
] as const;

describe("Editor multiline input", () => {
  for (const [terminalEncoding, sequence] of multilineKeySequences) {
    it(`inserts a newline for ${terminalEncoding} Shift+Enter without submitting`, () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      let submitted: string | undefined;
      editor.onSubmit = (text) => {
        submitted = text;
      };
      editor.setText("first");

      editor.handleInput(sequence);

      assert.strictEqual(editor.getText(), "first\n");
      assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 0 });
      assert.strictEqual(submitted, undefined);
    });
  }

  it("inserts Shift+Enter at the start of input", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    editor.setText("content");
    editor.handleInput("\x01");

    editor.handleInput("\x1b[13;2u");

    assert.strictEqual(editor.getText(), "\ncontent");
    assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 0 });
  });

  it("splits the current line when Shift+Enter is pressed in the middle", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    editor.setText("beforeafter");
    for (let index = 0; index < 5; index++) editor.handleInput("\x1b[D");

    editor.handleInput("\x1b[13;2u");

    assert.strictEqual(editor.getText(), "before\nafter");
    assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 0 });
  });

  it("preserves consecutive and blank lines", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    editor.setText("top");

    editor.handleInput("\x1b[13;2u");
    editor.handleInput("\x1b[13;2u");
    editor.handleInput("bottom");

    assert.strictEqual(editor.getText(), "top\n\nbottom");
  });

  it("submits the complete multiline prompt with Enter and clears the editor", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    let submitted: string | undefined;
    editor.onSubmit = (text) => {
      submitted = text;
    };
    editor.setText("first");
    editor.handleInput("\x1b[13;2u");
    editor.handleInput("second");

    editor.handleInput("\r");

    assert.strictEqual(submitted, "first\nsecond");
    assert.strictEqual(editor.getText(), "");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });
  });

  it("allows newlines while submission is disabled", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    let submitted = false;
    editor.onSubmit = () => {
      submitted = true;
    };
    editor.disableSubmit = true;
    editor.setText("working");

    editor.handleInput("\r");
    assert.strictEqual(editor.getText(), "working");
    editor.handleInput("\x1b[13;2u");

    assert.strictEqual(editor.getText(), "working\n");
    assert.strictEqual(submitted, false);
  });

  it("continues editing after a multiline paste without submitting", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    let submitted = false;
    editor.onSubmit = () => {
      submitted = true;
    };
    editor.handleInput("\x1b[200~one\ntwo\x1b[201~");

    editor.handleInput("\x1b[13;2u");
    editor.handleInput("three");

    assert.strictEqual(editor.getText(), "one\ntwo\nthree");
    assert.strictEqual(submitted, false);
  });

  it("turns a trailing backslash plus Enter into a newline fallback", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    editor.setText("first\\");

    editor.handleInput("\r");

    assert.strictEqual(editor.getText(), "first\n");
    assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 0 });
  });

  it("undoes a multiline insertion atomically", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    editor.setText("firstsecond");
    for (let index = 0; index < 6; index++) editor.handleInput("\x1b[D");
    editor.handleInput("\x1b[13;2u");

    editor.handleInput("\x1f");

    assert.strictEqual(editor.getText(), "firstsecond");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 5 });
  });
});
