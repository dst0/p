import assert from "node:assert";
import { describe, it } from "node:test";
import { Editor } from "../src/components/editor.ts";
import { createTestTUI } from "./editor-test-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Backslash+Enter newline workaround", () => {
    it("inserts backslash immediately (no buffering)", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.handleInput("\\");

      // Backslash should be visible immediately, not buffered
      assert.strictEqual(editor.getText(), "\\");
    });

    it("converts standalone backslash to newline on Enter", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.handleInput("\\");
      editor.handleInput("\r");

      assert.strictEqual(editor.getText(), "\n");
    });

    it("inserts backslash normally when followed by other characters", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.handleInput("\\");
      editor.handleInput("x");

      assert.strictEqual(editor.getText(), "\\x");
    });

    it("does not trigger newline when backslash is not immediately before cursor", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      let submitted = false;

      editor.onSubmit = () => {
        submitted = true;
      };

      editor.handleInput("\\");
      editor.handleInput("x");
      editor.handleInput("\r");

      // Should submit, not insert newline (backslash not at cursor)
      assert.strictEqual(submitted, true);
    });

    it("only removes one backslash when multiple are present", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.handleInput("\\");
      editor.handleInput("\\");
      editor.handleInput("\\");
      assert.strictEqual(editor.getText(), "\\\\\\");

      editor.handleInput("\r");
      // Only the last backslash is removed, newline inserted
      assert.strictEqual(editor.getText(), "\\\\\n");
    });
  });
});
