import assert from "node:assert";
import { describe, it } from "node:test";
import type { AutocompleteProvider } from "../src/autocomplete.ts";
import { Editor } from "../src/components/editor.ts";
import { applyCompletion, createTestTUI, flushAutocomplete } from "./editor-test-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component - Autocomplete (Part 1)", () => {
  it("auto-applies single force-file suggestion without showing menu", async () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    const mockProvider: AutocompleteProvider = {
      getSuggestions: async (lines, _cursorLine, cursorCol, options) => {
        if (!options.force) {
          return null;
        }
        const text = lines[0] || "";
        const prefix = text.slice(0, cursorCol);
        if (prefix === "Work") {
          return {
            items: [{ value: "Workspace/", label: "Workspace/" }],
            prefix: "Work",
          };
        }
        return null;
      },
      applyCompletion,
    };

    editor.setAutocompleteProvider(mockProvider);

    // Type "Work"
    editor.handleInput("W");
    editor.handleInput("o");
    editor.handleInput("r");
    editor.handleInput("k");
    assert.strictEqual(editor.getText(), "Work");

    // Press Tab - should auto-apply without showing menu
    editor.handleInput("\t");
    await flushAutocomplete();
    assert.strictEqual(editor.getText(), "Workspace/");
    assert.strictEqual(editor.isShowingAutocomplete(), false);

    // Undo should restore to "Work"
    editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
    assert.strictEqual(editor.getText(), "Work");
  });

  it("shows menu when force-file has multiple suggestions", async () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    const mockProvider: AutocompleteProvider = {
      getSuggestions: async (lines, _cursorLine, cursorCol, options) => {
        if (!options.force) {
          return null;
        }
        const text = lines[0] || "";
        const prefix = text.slice(0, cursorCol);
        if (prefix === "src") {
          return {
            items: [
              { value: "src/", label: "src/" },
              { value: "src.txt", label: "src.txt" },
            ],
            prefix: "src",
          };
        }
        return null;
      },
      applyCompletion,
    };

    editor.setAutocompleteProvider(mockProvider);

    // Type "src"
    editor.handleInput("s");
    editor.handleInput("r");
    editor.handleInput("c");
    assert.strictEqual(editor.getText(), "src");

    // Press Tab - should show menu because there are multiple suggestions
    editor.handleInput("\t");
    await flushAutocomplete();
    assert.strictEqual(editor.getText(), "src");
    assert.strictEqual(editor.isShowingAutocomplete(), true);

    // Press Tab again to accept first suggestion
    editor.handleInput("\t");
    assert.strictEqual(editor.getText(), "src/");
    assert.strictEqual(editor.isShowingAutocomplete(), false);
  });

  it("keeps suggestions open when typing in force mode (Tab-triggered)", async () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    const allFiles = [
      { value: "readme.md", label: "readme.md" },
      { value: "package.json", label: "package.json" },
      { value: "src/", label: "src/" },
      { value: "dist/", label: "dist/" },
    ];

    const mockProvider: AutocompleteProvider = {
      getSuggestions: async (lines, _cursorLine, cursorCol, options) => {
        const text = lines[0] || "";
        const prefix = text.slice(0, cursorCol);
        const shouldMatch = options.force || prefix.includes("/") || prefix.startsWith(".");
        if (!shouldMatch) {
          return null;
        }
        const filtered = allFiles.filter((f) => f.value.toLowerCase().startsWith(prefix.toLowerCase()));
        if (filtered.length > 0) {
          return { items: filtered, prefix };
        }
        return null;
      },
      applyCompletion,
    };

    editor.setAutocompleteProvider(mockProvider);

    // Press Tab on empty prompt - should show all files (force mode)
    editor.handleInput("\t");
    await flushAutocomplete();
    assert.strictEqual(editor.isShowingAutocomplete(), true);

    // Type "r" - should narrow to "readme.md" (force mode keeps suggestions open)
    editor.handleInput("r");
    await flushAutocomplete();
    assert.strictEqual(editor.getText(), "r");
    assert.strictEqual(editor.isShowingAutocomplete(), true);

    // Type "e" - should still show "readme.md"
    editor.handleInput("e");
    await flushAutocomplete();
    assert.strictEqual(editor.getText(), "re");
    assert.strictEqual(editor.isShowingAutocomplete(), true);

    // Accept with Tab
    editor.handleInput("\t");
    assert.strictEqual(editor.getText(), "readme.md");
    assert.strictEqual(editor.isShowingAutocomplete(), false);
  });

  it("debounces @ autocomplete while typing", async () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    let suggestionCalls = 0;

    const mockProvider: AutocompleteProvider = {
      getSuggestions: async (lines, _cursorLine, cursorCol) => {
        suggestionCalls += 1;
        const text = (lines[0] || "").slice(0, cursorCol);
        return {
          items: [{ value: "@main.ts", label: "main.ts" }],
          prefix: text,
        };
      },
      applyCompletion,
    };

    editor.setAutocompleteProvider(mockProvider);

    editor.handleInput("@");
    editor.handleInput("m");
    editor.handleInput("a");
    editor.handleInput("i");

    assert.strictEqual(suggestionCalls, 0);
    assert.strictEqual(editor.isShowingAutocomplete(), false);

    await new Promise((resolve) => setTimeout(resolve, 50));
    await flushAutocomplete();

    assert.strictEqual(suggestionCalls, 1);
    assert.strictEqual(editor.isShowingAutocomplete(), true);
  });
});
