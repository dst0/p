import assert from "node:assert";
import { describe, it } from "node:test";
import { Editor } from "../src/components/editor.ts";
import { createTestTUI } from "./editor-test-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Kitty CSI-u handling", () => {
    it("ignores printable CSI-u sequences with unsupported modifiers", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.handleInput("\x1b[99;9u");

      assert.strictEqual(editor.getText(), "");
    });

    it("inserts shifted CSI-u letters as text", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.handleInput("\x1b[69;2u");

      assert.strictEqual(editor.getText(), "E");
    });

    it("inserts shifted xterm modifyOtherKeys letters as text", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.handleInput("\x1b[27;2;69~");

      assert.strictEqual(editor.getText(), "E");
    });
  });
});
