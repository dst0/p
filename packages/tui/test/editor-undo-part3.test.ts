import assert from "node:assert";
import { describe, it } from "node:test";
import type { AutocompleteProvider } from "../src/autocomplete.ts";
import { Editor } from "../src/components/editor.ts";
import { applyCompletion, createTestTUI, flushAutocomplete } from "./editor-test-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component - Undo (Part 3)", () => {
  it("undo restores to pre-history state even after multiple history navigations", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    // Add history entries
    editor.addToHistory("first");
    editor.addToHistory("second");
    editor.addToHistory("third");

    // Type something
    editor.handleInput("c");
    editor.handleInput("u");
    editor.handleInput("r");
    editor.handleInput("r");
    editor.handleInput("e");
    editor.handleInput("n");
    editor.handleInput("t");
    assert.strictEqual(editor.getText(), "current");

    // Clear editor
    editor.handleInput("\x17"); // Ctrl+W
    assert.strictEqual(editor.getText(), "");

    // Navigate through history multiple times
    editor.handleInput("\x1b[A"); // Up - "third"
    assert.strictEqual(editor.getText(), "third");
    editor.handleInput("\x1b[A"); // Up - "second"
    assert.strictEqual(editor.getText(), "second");
    editor.handleInput("\x1b[A"); // Up - "first"
    assert.strictEqual(editor.getText(), "first");

    // Undo should go back to "" (state before we started browsing), not intermediate states
    editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
    assert.strictEqual(editor.getText(), "");

    // Another undo goes back to "current"
    editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
    assert.strictEqual(editor.getText(), "current");
  });

  it("cursor movement starts new undo unit", () => {
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

    // Move cursor left 5 (to after "hello ")
    for (let i = 0; i < 5; i++) editor.handleInput("\x1b[D");

    // Type "lol" in the middle
    editor.handleInput("l");
    editor.handleInput("o");
    editor.handleInput("l");
    assert.strictEqual(editor.getText(), "hello lolworld");

    // Undo should restore to "hello world" (before inserting "lol")
    editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
    assert.strictEqual(editor.getText(), "hello world");

    editor.handleInput("|");
    assert.strictEqual(editor.getText(), "hello |world");
  });

  it("no-op delete operations do not push undo snapshots", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.handleInput("h");
    editor.handleInput("e");
    editor.handleInput("l");
    editor.handleInput("l");
    editor.handleInput("o");
    assert.strictEqual(editor.getText(), "hello");

    // Delete word on empty - multiple times (should be no-ops)
    editor.handleInput("\x17"); // Ctrl+W - deletes "hello"
    assert.strictEqual(editor.getText(), "");
    editor.handleInput("\x17"); // Ctrl+W - no-op (nothing to delete)
    editor.handleInput("\x17"); // Ctrl+W - no-op

    // Single undo should restore "hello"
    editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
    assert.strictEqual(editor.getText(), "hello");
  });

  it("undoes autocomplete", async () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    // Create a mock autocomplete provider
    const mockProvider: AutocompleteProvider = {
      getSuggestions: async (lines, _cursorLine, cursorCol) => {
        const text = lines[0] || "";
        const prefix = text.slice(0, cursorCol);
        if (prefix === "di") {
          return {
            items: [{ value: "dist/", label: "dist/" }],
            prefix: "di",
          };
        }
        return null;
      },
      applyCompletion,
    };

    editor.setAutocompleteProvider(mockProvider);

    // Type "di"
    editor.handleInput("d");
    editor.handleInput("i");
    assert.strictEqual(editor.getText(), "di");

    // Press Tab to trigger autocomplete
    editor.handleInput("\t");
    await flushAutocomplete();
    assert.strictEqual(editor.getText(), "dist/");
    assert.strictEqual(editor.isShowingAutocomplete(), false);

    // Undo should restore to "di"
    editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
    assert.strictEqual(editor.getText(), "di");
  });
});
