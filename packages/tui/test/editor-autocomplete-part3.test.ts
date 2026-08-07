import assert from "node:assert";
import { describe, it } from "node:test";
import type { AutocompleteProvider } from "../src/autocomplete.ts";
import { Editor } from "../src/components/editor.ts";
import { applyCompletion, createTestTUI, flushAutocomplete } from "./editor-test-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component - Autocomplete (Part 3)", () => {
  it("hides autocomplete when backspacing slash command to empty", async () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    // Mock provider with slash commands
    const mockProvider: AutocompleteProvider = {
      getSuggestions: async (lines, _cursorLine, cursorCol) => {
        const text = lines[0] || "";
        const prefix = text.slice(0, cursorCol);
        // Only return slash command suggestions when line starts with /
        if (prefix.startsWith("/")) {
          const commands = [
            { value: "/model", label: "model", description: "Change model" },
            { value: "/help", label: "help", description: "Show help" },
          ];
          const query = prefix.slice(1); // Remove leading /
          const filtered = commands.filter((c) => c.value.startsWith(query));
          if (filtered.length > 0) {
            return { items: filtered, prefix };
          }
        }
        return null;
      },
      applyCompletion,
    };

    editor.setAutocompleteProvider(mockProvider);

    // Type "/" - should show slash command suggestions
    editor.handleInput("/");
    await flushAutocomplete();
    assert.strictEqual(editor.getText(), "/");
    assert.strictEqual(editor.isShowingAutocomplete(), true);

    // Backspace to delete "/" - should hide autocomplete completely
    editor.handleInput("\x7f"); // Backspace
    await flushAutocomplete();
    assert.strictEqual(editor.getText(), "");
    assert.strictEqual(editor.isShowingAutocomplete(), false);
  });

  it("applies exact typed slash-argument value on Enter even when first item is highlighted", async () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    // Mock provider for /argtest command with argument completions
    const mockProvider: AutocompleteProvider = {
      getSuggestions: async (lines, _cursorLine, cursorCol) => {
        const text = lines[0] || "";
        const beforeCursor = text.slice(0, cursorCol);

        // Check if we're in argument completion context: "/argtest <prefix>"
        const argtestMatch = beforeCursor.match(/^\/argtest\s+(\S+)$/);
        if (argtestMatch) {
          const argumentText = argtestMatch[1]!;
          const allArguments = [
            { value: "one", label: "one" },
            { value: "two", label: "two" },
            { value: "three", label: "three" },
          ];
          // Return all arguments that start with the typed prefix
          const filtered = allArguments.filter((arg) => arg.value.startsWith(argumentText));
          if (filtered.length > 0) {
            return { items: filtered, prefix: argumentText };
          }
        }
        return null;
      },
      applyCompletion,
    };

    editor.setAutocompleteProvider(mockProvider);

    // Type "/argtest two"
    editor.handleInput("/");
    editor.handleInput("a");
    editor.handleInput("r");
    editor.handleInput("g");
    editor.handleInput("t");
    editor.handleInput("e");
    editor.handleInput("s");
    editor.handleInput("t");
    editor.handleInput(" ");
    editor.handleInput("t");
    editor.handleInput("w");
    editor.handleInput("o");

    assert.strictEqual(editor.getText(), "/argtest two");
    await flushAutocomplete();
    assert.strictEqual(editor.isShowingAutocomplete(), true);

    // Press Enter - should apply the exact typed value "two", not the first item
    editor.handleInput("\r");

    // The exact typed value "two" should be retained
    assert.strictEqual(editor.getText(), "/argtest two");
  });

  it("selects first prefix match on Enter when typed arg is not exact match", async () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    // Mock provider for /argtest command with argument completions
    const mockProvider: AutocompleteProvider = {
      getSuggestions: async (lines, _cursorLine, cursorCol) => {
        const text = lines[0] || "";
        const beforeCursor = text.slice(0, cursorCol);

        // Check if we're in argument completion context
        const argtestMatch = beforeCursor.match(/^\/argtest\s+(\S+)$/);
        if (argtestMatch) {
          const argumentText = argtestMatch[1]!;
          const allArguments = [
            { value: "two", label: "two" },
            { value: "three", label: "three" },
            { value: "twelve", label: "twelve" },
          ];
          // Return all items that start with the typed prefix
          const filtered = allArguments.filter((arg) => arg.value.startsWith(argumentText));
          if (filtered.length > 0) {
            return { items: filtered, prefix: argumentText };
          }
        }
        return null;
      },
      applyCompletion,
    };

    editor.setAutocompleteProvider(mockProvider);

    // Type "/argtest t" - filtered to [two, three, twelve], prefix "t" matches "two" first
    editor.handleInput("/");
    editor.handleInput("a");
    editor.handleInput("r");
    editor.handleInput("g");
    editor.handleInput("t");
    editor.handleInput("e");
    editor.handleInput("s");
    editor.handleInput("t");
    editor.handleInput(" ");
    editor.handleInput("t");

    await flushAutocomplete();
    assert.strictEqual(editor.isShowingAutocomplete(), true);

    // Press Enter - "t" prefix matches "two" (first in list), so "two" is applied
    editor.handleInput("\r");
    assert.strictEqual(editor.getText(), "/argtest two");
  });

  it("highlights unique prefix match as user types (before full exact match)", async () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    // Mock provider that returns all items unfiltered (like real extensions do)
    const mockProvider: AutocompleteProvider = {
      getSuggestions: async (lines, _cursorLine, cursorCol) => {
        const text = lines[0] || "";
        const beforeCursor = text.slice(0, cursorCol);

        const argtestMatch = beforeCursor.match(/^\/argtest\s+(\S+)$/);
        if (argtestMatch) {
          const argumentText = argtestMatch[1]!;
          // Return all items - provider does not filter
          const allArguments = [
            { value: "one", label: "one" },
            { value: "two", label: "two" },
            { value: "three", label: "three" },
          ];
          return { items: allArguments, prefix: argumentText };
        }
        return null;
      },
      applyCompletion,
    };

    editor.setAutocompleteProvider(mockProvider);

    // Type "/argtest tw" - "tw" is a prefix of only "two"
    editor.handleInput("/");
    editor.handleInput("a");
    editor.handleInput("r");
    editor.handleInput("g");
    editor.handleInput("t");
    editor.handleInput("e");
    editor.handleInput("s");
    editor.handleInput("t");
    editor.handleInput(" ");
    editor.handleInput("t");
    editor.handleInput("w");

    assert.strictEqual(editor.getText(), "/argtest tw");
    await flushAutocomplete();
    assert.strictEqual(editor.isShowingAutocomplete(), true);

    // Press Enter - "tw" uniquely matches "two", so "two" should be applied
    editor.handleInput("\r");
    assert.strictEqual(editor.getText(), "/argtest two");
  });
});
