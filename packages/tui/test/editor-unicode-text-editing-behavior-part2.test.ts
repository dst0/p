import assert from "node:assert";
import { describe, it } from "node:test";
import { Editor } from "../src/components/editor.ts";
import { createTestTUI } from "./editor-test-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component - Unicode text editing behavior (Part 2)", () => {
  it("navigates words correctly with Ctrl+Left/Right", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("foo bar... baz");
    // Cursor at end

    // Move left over baz
    editor.handleInput("\x1b[1;5D"); // Ctrl+Left
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 11 }); // after '...'

    // Move left over punctuation
    editor.handleInput("\x1b[1;5D"); // Ctrl+Left
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 }); // after 'bar'

    // Move left over bar
    editor.handleInput("\x1b[1;5D"); // Ctrl+Left
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 4 }); // after 'foo '

    // Move right over bar
    editor.handleInput("\x1b[1;5C"); // Ctrl+Right
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 }); // at end of 'bar'

    // Move right over punctuation run
    editor.handleInput("\x1b[1;5C"); // Ctrl+Right
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 10 }); // after '...'

    // Move right skips space and lands after baz
    editor.handleInput("\x1b[1;5C"); // Ctrl+Right
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 14 }); // end of line

    // Test forward from start with leading whitespace
    editor.setText("   foo bar");
    editor.handleInput("\x01"); // Ctrl+A to go to start
    editor.handleInput("\x1b[1;5C"); // Ctrl+Right
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 6 }); // after 'foo'

    // ASCII punctuation inside Intl word-like segments preserves old boundaries
    editor.setText("foo.bar baz");
    editor.handleInput("\x1b[1;5D"); // Ctrl+Left over baz
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 8 });
    editor.handleInput("\x1b[1;5D"); // Ctrl+Left over bar
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 4 });
    editor.handleInput("\x1b[1;5D"); // Ctrl+Left over .
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 3 });

    editor.handleInput("\x01"); // Ctrl+A
    editor.handleInput("\x1b[1;5C"); // Ctrl+Right over foo
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 3 });
    editor.handleInput("\x1b[1;5C"); // Ctrl+Right over .
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 4 });
    editor.handleInput("\x1b[1;5C"); // Ctrl+Right over bar
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 });
  });

  it("stops at fullwidth Chinese punctuation (issue #4972)", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    // 你好，世界 = 你好(0-2) ，(2-3) 世界(3-5)
    editor.setText("你好，世界");
    // Cursor at end (col 5)

    // Move left over 世界
    editor.handleInput("\x1b[1;5D"); // Ctrl+Left
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 3 }); // after ，

    // Move left over ，
    editor.handleInput("\x1b[1;5D"); // Ctrl+Left
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 2 }); // after 你好

    // Move left over 你好
    editor.handleInput("\x1b[1;5D"); // Ctrl+Left
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 }); // start

    // Move right over 你好
    editor.handleInput("\x1b[1;5C"); // Ctrl+Right
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 2 }); // after 你好

    // Move right over ，
    editor.handleInput("\x1b[1;5C"); // Ctrl+Right
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 3 }); // after ，

    // Move right over 世界
    editor.handleInput("\x1b[1;5C"); // Ctrl+Right
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 5 }); // end
  });

  it("handles mixed CJK and ASCII word movement", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    // "hello你好，world世界" = hello(0-5) 你好(5-7) ，(7-8) world(8-13) 世界(13-15)
    editor.setText("hello你好，world世界");
    // Cursor at end (col 15)

    // Move left over 世界
    editor.handleInput("\x1b[1;5D"); // Ctrl+Left
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 13 }); // after 'world'

    // Move left over world
    editor.handleInput("\x1b[1;5D"); // Ctrl+Left
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 8 }); // after ，

    // Move left over ，
    editor.handleInput("\x1b[1;5D"); // Ctrl+Left
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 }); // after 你好

    // Move left over 你好
    editor.handleInput("\x1b[1;5D"); // Ctrl+Left
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 5 }); // after 'hello'

    // Move left over hello
    editor.handleInput("\x1b[1;5D"); // Ctrl+Left
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 }); // start

    // Forward from start
    editor.handleInput("\x1b[1;5C"); // Ctrl+Right
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 5 }); // after 'hello'

    editor.handleInput("\x1b[1;5C"); // Ctrl+Right
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 }); // after 你好

    editor.handleInput("\x1b[1;5C"); // Ctrl+Right
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 8 }); // after ，

    editor.handleInput("\x1b[1;5C"); // Ctrl+Right
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 13 }); // after 'world'

    editor.handleInput("\x1b[1;5C"); // Ctrl+Right
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 15 }); // end
  });
});
