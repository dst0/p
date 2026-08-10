import assert from "node:assert";
import { describe, it } from "node:test";
import type { AutocompleteProvider } from "../src/autocomplete.ts";
import { Editor } from "../src/components/editor.ts";
import { applyCompletion, createTestTUI } from "./editor-test-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component - Undo (Part 2)", () => {
  it("undoes single-line paste atomically", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("hello world");
    editor.handleInput("\x01"); // Ctrl+A - go to start
    for (let i = 0; i < 5; i++) editor.handleInput("\x1b[C"); // Move right 5 (after "hello", before space)

    // Simulate bracketed paste of "beep boop"
    editor.handleInput("\x1b[200~beep boop\x1b[201~");
    assert.strictEqual(editor.getText(), "hellobeep boop world");

    // Single undo should restore entire pre-paste state
    editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
    assert.strictEqual(editor.getText(), "hello world");

    editor.handleInput("|");
    assert.strictEqual(editor.getText(), "hello| world");
  });

  it("does not trigger autocomplete during single-line paste", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    let suggestionCalls = 0;

    const mockProvider: AutocompleteProvider = {
      getSuggestions: async () => {
        suggestionCalls += 1;
        return null;
      },
      applyCompletion,
    };

    editor.setAutocompleteProvider(mockProvider);
    editor.handleInput("\x1b[200~look at @node_modules/react/index.js please\x1b[201~");

    assert.strictEqual(editor.getText(), "look at @node_modules/react/index.js please");
    assert.strictEqual(suggestionCalls, 0);
    assert.strictEqual(editor.isShowingAutocomplete(), false);
  });

  it("decodes CSI-u Ctrl+letter sequences inside bracketed paste (tmux popup)", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    // tmux popups with extended-keys-format=csi-u re-encode \n in pastes as
    // \x1b[106;5u (Ctrl+J). Without decoding, the per-char filter strips ESC
    // and leaks "[106;5u" between lines. See issue #3599.
    editor.handleInput("\x1b[200~line1\x1b[106;5uline2\x1b[106;5uline3\x1b[201~");
    assert.strictEqual(editor.getText(), "line1\nline2\nline3");
  });

  it("undoes multi-line paste atomically", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("hello world");
    editor.handleInput("\x01"); // Ctrl+A - go to start
    for (let i = 0; i < 5; i++) editor.handleInput("\x1b[C"); // Move right 5 (after "hello", before space)

    // Simulate bracketed paste of multi-line text
    editor.handleInput("\x1b[200~line1\nline2\nline3\x1b[201~");
    assert.strictEqual(editor.getText(), "helloline1\nline2\nline3 world");

    // Single undo should restore entire pre-paste state
    editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
    assert.strictEqual(editor.getText(), "hello world");

    editor.handleInput("|");
    assert.strictEqual(editor.getText(), "hello| world");
  });

  it("undoes insertTextAtCursor atomically", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("hello world");
    editor.handleInput("\x01"); // Ctrl+A - go to start
    for (let i = 0; i < 5; i++) editor.handleInput("\x1b[C"); // Move right 5 (after "hello", before space)

    // Programmatic insertion (e.g., clipboard image path)
    editor.insertTextAtCursor("/tmp/image.png");
    assert.strictEqual(editor.getText(), "hello/tmp/image.png world");

    // Single undo should restore entire pre-insert state
    editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
    assert.strictEqual(editor.getText(), "hello world");

    editor.handleInput("|");
    assert.strictEqual(editor.getText(), "hello| world");
  });

  it("insertTextAtCursor handles multiline text", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("hello world");
    editor.handleInput("\x01"); // Ctrl+A - go to start
    for (let i = 0; i < 5; i++) editor.handleInput("\x1b[C"); // Move right 5 (after "hello", before space)

    // Insert multiline text
    editor.insertTextAtCursor("line1\nline2\nline3");
    assert.strictEqual(editor.getText(), "helloline1\nline2\nline3 world");

    // Cursor should be at end of inserted text (after "line3", before " world")
    const cursor = editor.getCursor();
    assert.strictEqual(cursor.line, 2);
    assert.strictEqual(cursor.col, 5); // "line3".length

    // Single undo should restore entire pre-insert state
    editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
    assert.strictEqual(editor.getText(), "hello world");
  });

  it("insertTextAtCursor normalizes CRLF and CR line endings", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("");

    // Insert text with CRLF
    editor.insertTextAtCursor("a\r\nb\r\nc");
    assert.strictEqual(editor.getText(), "a\nb\nc");

    editor.handleInput("\x1b[45;5u"); // Undo
    assert.strictEqual(editor.getText(), "");

    // Insert text with CR only
    editor.insertTextAtCursor("x\ry\rz");
    assert.strictEqual(editor.getText(), "x\ny\nz");
  });

  it("undoes setText to empty string", () => {
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

    editor.setText("");
    assert.strictEqual(editor.getText(), "");

    editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
    assert.strictEqual(editor.getText(), "hello world");
  });

  it("clears undo stack on submit", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    let submitted = "";
    editor.onSubmit = (text) => {
      submitted = text;
    };

    editor.handleInput("h");
    editor.handleInput("e");
    editor.handleInput("l");
    editor.handleInput("l");
    editor.handleInput("o");
    editor.handleInput("\r"); // Enter - submit

    assert.strictEqual(submitted, "hello");
    assert.strictEqual(editor.getText(), "");

    // Undo should do nothing - stack was cleared
    editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
    assert.strictEqual(editor.getText(), "");
  });

  it("exits history browsing mode on undo", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    // Add "hello" to history
    editor.addToHistory("hello");
    assert.strictEqual(editor.getText(), "");

    // Type "world"
    editor.handleInput("w");
    editor.handleInput("o");
    editor.handleInput("r");
    editor.handleInput("l");
    editor.handleInput("d");
    assert.strictEqual(editor.getText(), "world");

    // Ctrl+W - delete word
    editor.handleInput("\x17"); // Ctrl+W
    assert.strictEqual(editor.getText(), "");

    // Press Up - enter history browsing, shows "hello"
    editor.handleInput("\x1b[A"); // Up arrow
    assert.strictEqual(editor.getText(), "hello");

    // Undo should restore to "" (state before entering history browsing)
    editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
    assert.strictEqual(editor.getText(), "");

    // Undo again should restore to "world" (state before Ctrl+W)
    editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
    assert.strictEqual(editor.getText(), "world");
  });
});
