import assert from "node:assert";
import { describe, it } from "node:test";
import { type AutocompleteProvider, CombinedAutocompleteProvider } from "../src/autocomplete.ts";
import { Editor } from "../src/components/editor.ts";
import { applyCompletion, createTestTUI, flushAutocomplete } from "./editor-test-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component - Autocomplete (Part 4)", () => {
  it("selects first prefix match when multiple items match", async () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    // Mock provider that returns all items unfiltered
    const mockProvider: AutocompleteProvider = {
      getSuggestions: async (lines, _cursorLine, cursorCol) => {
        const text = lines[0] || "";
        const beforeCursor = text.slice(0, cursorCol);

        const argtestMatch = beforeCursor.match(/^\/argtest\s+(\S+)$/);
        if (argtestMatch) {
          const argumentText = argtestMatch[1]!;
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

    // Type "/argtest t" - "t" is a prefix of both "two" and "three"
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

    // Press Enter - "t" matches "two" first, so "two" is selected
    editor.handleInput("\r");
    assert.strictEqual(editor.getText(), "/argtest two");
  });

  it("works for built-in-style command argument completion path (model-like)", async () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    // Mock provider for /model command with model completions
    const mockProvider: AutocompleteProvider = {
      getSuggestions: async (lines, _cursorLine, cursorCol) => {
        const text = lines[0] || "";
        const beforeCursor = text.slice(0, cursorCol);

        // Check if we're in /model argument completion context
        // Use [^ ]+ to match any non-space characters (including hyphens)
        const modelMatch = beforeCursor.match(/^\/model\s+(\S+)$/);
        if (modelMatch) {
          const modelText = modelMatch[1]!;
          const allModels = [
            { value: "gpt-4o", label: "gpt-4o" },
            { value: "gpt-4o-mini", label: "gpt-4o-mini" },
            { value: "claude-sonnet", label: "claude-sonnet" },
          ];
          // Return all models that start with the typed prefix
          const filtered = allModels.filter((m) => m.value.startsWith(modelText));
          if (filtered.length > 0) {
            return { items: filtered, prefix: modelText };
          }
        }
        return null;
      },
      applyCompletion,
    };

    editor.setAutocompleteProvider(mockProvider);

    // Type "/model gpt-4o-mini" - exact match for second item in list
    editor.handleInput("/");
    editor.handleInput("m");
    editor.handleInput("o");
    editor.handleInput("d");
    editor.handleInput("e");
    editor.handleInput("l");
    editor.handleInput(" ");
    editor.handleInput("g");
    editor.handleInput("p");
    editor.handleInput("t");
    editor.handleInput("-");
    editor.handleInput("4");
    editor.handleInput("o");
    editor.handleInput("-");
    editor.handleInput("m");
    editor.handleInput("i");
    editor.handleInput("n");
    editor.handleInput("i");

    assert.strictEqual(editor.getText(), "/model gpt-4o-mini");
    await flushAutocomplete();
    assert.strictEqual(editor.isShowingAutocomplete(), true);

    // Press Enter - should retain exact typed value, not apply first highlighted item
    editor.handleInput("\r");

    // The exact typed value should be retained
    assert.strictEqual(editor.getText(), "/model gpt-4o-mini");
  });

  it("awaits async slash command argument completions", async () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    const provider = new CombinedAutocompleteProvider(
      [
        {
          name: "load-skills",
          description: "Load skills",
          getArgumentCompletions: async (prefix) =>
            prefix.startsWith("s") ? [{ value: "skill-a", label: "skill-a" }] : null,
        },
      ],
      process.cwd(),
    );
    editor.setAutocompleteProvider(provider);
    editor.setText("/load-skills ");

    editor.handleInput("s");
    await flushAutocomplete();
    assert.strictEqual(editor.isShowingAutocomplete(), true);

    editor.handleInput("\t");
    assert.strictEqual(editor.getText(), "/load-skills skill-a");
    assert.strictEqual(editor.isShowingAutocomplete(), false);
  });

  it("ignores invalid slash command argument completion results", async () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    const provider = new CombinedAutocompleteProvider(
      [
        {
          name: "load-skills",
          description: "Load skills",
          getArgumentCompletions: (() => "not-an-array") as unknown as (
            argumentPrefix: string,
          ) => Promise<{ value: string; label: string }[] | null>,
        },
      ],
      process.cwd(),
    );
    editor.setAutocompleteProvider(provider);
    editor.setText("/load-skills ");

    editor.handleInput("s");
    await flushAutocomplete();
    assert.strictEqual(editor.isShowingAutocomplete(), false);
    assert.strictEqual(editor.getText(), "/load-skills s");
  });

  it("does not show argument completions when command has no argument completer", async () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    const provider = new CombinedAutocompleteProvider(
      [
        { name: "help", description: "Show help" },
        {
          name: "model",
          description: "Switch model",
          getArgumentCompletions: () => [{ value: "claude-opus", label: "claude-opus" }],
        },
      ],
      process.cwd(),
    );
    editor.setAutocompleteProvider(provider);

    editor.handleInput("/");
    editor.handleInput("h");
    editor.handleInput("e");
    await flushAutocomplete();
    assert.strictEqual(editor.isShowingAutocomplete(), true);

    editor.handleInput("\t");
    assert.strictEqual(editor.getText(), "/help ");
    assert.strictEqual(editor.isShowingAutocomplete(), false);
  });
});
