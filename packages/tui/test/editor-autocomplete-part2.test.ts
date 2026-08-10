import assert from "node:assert";
import { describe, it } from "node:test";
import { stripVTControlCharacters } from "node:util";
import type { AutocompleteProvider } from "../src/autocomplete.ts";
import { Editor } from "../src/components/editor.ts";
import { applyCompletion, createTestTUI, flushAutocomplete } from "./editor-test-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component - Autocomplete (Part 2)", () => {
  it("re-queries the autocomplete picker when the cursor moves back into the command name", async () => {
    // Regression for dst0/p#5496: arrowing left out of a slash
    // command's argument region must re-query the picker, not leave the
    // stale argument list showing. Before the fix, moveCursor() never
    // called updateAutocomplete(), so `/cmd ` (argument menu) + Left kept
    // displaying the arguments against a `/cmd` prefix — and a Tab there
    // would concatenate the stale suggestion onto the partial command name.
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    const mockProvider: AutocompleteProvider = {
      getSuggestions: async (lines, _cursorLine, cursorCol) => {
        const before = (lines[0] || "").slice(0, cursorCol);
        if (!before.startsWith("/")) return null;
        // Past the command name (a space before the cursor): offer arguments.
        if (before.includes(" ")) {
          return {
            items: [
              { value: "repo", label: "repo" },
              { value: "message", label: "message" },
              { value: "help", label: "help" },
            ],
            prefix: before.slice(before.indexOf(" ") + 1),
          };
        }
        // Inside the command name: offer the command name only.
        return { items: [{ value: "cmd", label: "cmd" }], prefix: before };
      },
      applyCompletion,
    };

    editor.setAutocompleteProvider(mockProvider);

    // Type `/cmd ` so the picker ends up showing the argument list.
    for (const ch of "/cmd ") {
      editor.handleInput(ch);
      await flushAutocomplete();
    }
    assert.strictEqual(editor.getText(), "/cmd ");
    assert.strictEqual(editor.isShowingAutocomplete(), true);
    const atArg = editor
      .render(80)
      .map((l) => stripVTControlCharacters(l))
      .join("\n");
    assert.ok(atArg.includes("repo"), "argument menu should be visible at `/cmd `");

    // Arrow Left back into the command name (`/cmd`).
    editor.handleInput("\x1b[D");
    await flushAutocomplete();

    // The picker must have re-queried: the stale argument items are gone
    // (replaced by the command-name suggestion, or the picker closed).
    const afterMove = editor
      .render(80)
      .map((l) => stripVTControlCharacters(l))
      .join("\n");
    assert.ok(!afterMove.includes("repo"), "stale argument menu must not survive the cursor move");
    assert.ok(!afterMove.includes("message"), "stale argument menu must not survive the cursor move");
  });

  it("debounces # autocomplete while typing", async () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    let suggestionCalls = 0;

    const mockProvider: AutocompleteProvider = {
      getSuggestions: async (lines, _cursorLine, cursorCol) => {
        suggestionCalls += 1;
        const text = (lines[0] || "").slice(0, cursorCol);
        return {
          items: [{ value: "#2983", label: "#2983" }],
          prefix: text,
        };
      },
      applyCompletion,
    };

    editor.setAutocompleteProvider(mockProvider);

    editor.handleInput("#");
    editor.handleInput("2");
    editor.handleInput("9");
    editor.handleInput("8");

    assert.strictEqual(suggestionCalls, 0);
    assert.strictEqual(editor.isShowingAutocomplete(), false);

    await new Promise((resolve) => setTimeout(resolve, 50));
    await flushAutocomplete();

    assert.strictEqual(suggestionCalls, 1);
    assert.strictEqual(editor.isShowingAutocomplete(), true);
  });

  it("debounces custom triggerCharacters autocomplete while typing", async () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    let suggestionCalls = 0;

    editor.setAutocompleteProvider({
      triggerCharacters: ["$"],
      getSuggestions: async (lines, _cursorLine, cursorCol) => {
        suggestionCalls += 1;
        const prefix = (lines[0] || "").slice(0, cursorCol);
        return { items: [{ value: "$skill-name", label: "skill-name" }], prefix };
      },
      applyCompletion,
    });

    editor.handleInput("$");
    editor.handleInput("s");
    editor.handleInput("k");

    assert.strictEqual(suggestionCalls, 0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await flushAutocomplete();

    assert.strictEqual(suggestionCalls, 1);
    assert.strictEqual(editor.isShowingAutocomplete(), true);
  });

  it("resets custom triggerCharacters when provider changes", async () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    let suggestionCalls = 0;

    editor.setAutocompleteProvider({
      triggerCharacters: ["$"],
      getSuggestions: async () => ({ items: [{ value: "$skill-name", label: "skill-name" }], prefix: "$" }),
      applyCompletion,
    });
    editor.setAutocompleteProvider({
      getSuggestions: async () => {
        suggestionCalls += 1;
        return { items: [{ value: "$skill-name", label: "skill-name" }], prefix: "$" };
      },
      applyCompletion,
    });

    editor.handleInput("$");
    editor.handleInput("s");
    await new Promise((resolve) => setTimeout(resolve, 50));
    await flushAutocomplete();

    assert.strictEqual(suggestionCalls, 0);
    assert.strictEqual(editor.isShowingAutocomplete(), false);
  });

  it("aborts active @ autocomplete when typing continues", async () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    let aborts = 0;

    const mockProvider: AutocompleteProvider = {
      getSuggestions: async (_lines, _cursorLine, _cursorCol, options) => {
        return await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            resolve({ items: [{ value: "@main.ts", label: "main.ts" }], prefix: "@main" });
          }, 500);
          options.signal.addEventListener(
            "abort",
            () => {
              aborts += 1;
              clearTimeout(timeout);
              resolve(null);
            },
            { once: true },
          );
        });
      },
      applyCompletion,
    };

    editor.setAutocompleteProvider(mockProvider);

    editor.handleInput("@");
    editor.handleInput("m");
    editor.handleInput("a");
    editor.handleInput("i");
    await new Promise((resolve) => setTimeout(resolve, 250));
    editor.handleInput("n");
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.strictEqual(aborts, 1);
  });
});
