import assert from "node:assert";
import { describe, it } from "node:test";
import { Editor } from "../src/components/editor.ts";
import { createTestTUI } from "./editor-test-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("public state accessors", () => {
    it("returns cursor position", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      editor.handleInput("a");
      editor.handleInput("b");
      editor.handleInput("c");

      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 3 });

      editor.handleInput("\x1b[D"); // Left
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 2 });
    });

    it("returns lines as a defensive copy", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      editor.setText("a\nb");

      const lines = editor.getLines();
      assert.deepStrictEqual(lines, ["a", "b"]);

      lines[0] = "mutated";
      assert.deepStrictEqual(editor.getLines(), ["a", "b"]);
    });
  });
});
