import { describe, expect, it } from "vitest";
import { applyEditsToNormalizedContent, fuzzyFindText } from "../src/core/tools/edit-diff.ts";

describe("fuzzyFindText line-trimmed matching", () => {
  it("finds exact matches without fuzzy matching", () => {
    const content = "function test() {\n  return 42;\n}";
    const oldText = "return 42;";
    const result = fuzzyFindText(content, oldText);
    expect(result.found).toBe(true);
    expect(result.usedFuzzyMatch).toBe(false);
  });

  it("finds fuzzy matches when line leading/trailing whitespace differs", () => {
    const content = "function test() {\n  const a = 1;\n    return a;\n}";
    // LLM sends 4 spaces then 2 spaces, content has 2 spaces then 4 spaces
    const oldText = "    const a = 1;\n  return a;";
    const result = fuzzyFindText(content, oldText);
    expect(result.found).toBe(true);
    expect(result.usedFuzzyMatch).toBe(true);
  });

  it("applies edits successfully when indentation differs slightly and preserves original indentation", () => {
    const content = "class Foo {\n    bar() {\n        return 'baz';\n    }\n}";
    const edits = [{ oldText: "  bar() {\n    return 'baz';\n  }", newText: "  bar() {\n    return 'qux';\n  }" }];
    const res = applyEditsToNormalizedContent(content, edits, "test.ts");
    expect(res.newContent).toContain("    bar() {\n      return 'qux';\n    }");
  });

  it("does not add trailing spaces to blank lines during indentation adjustment", () => {
    const content = "class Foo {\n    bar() {\n\n        return 'baz';\n    }\n}";
    const edits = [{ oldText: "  bar() {\n\n    return 'baz';\n  }", newText: "  bar() {\n\n    return 'qux';\n  }" }];
    const res = applyEditsToNormalizedContent(content, edits, "test.ts");
    const lines = res.newContent.split("\n");
    // Ensure the empty line at index 2 has no trailing spaces
    expect(lines[2]).toBe("");
  });

  it("handles un-indentation when oldText had more indentation than original", () => {
    const content = "function foo() {\n  return 1;\n}";
    const edits = [
      {
        oldText: "    function foo() {\n      return 1;\n    }",
        newText: "    function foo() {\n      return 2;\n    }",
      },
    ];
    const res = applyEditsToNormalizedContent(content, edits, "test.ts");
    expect(res.newContent).toBe("function foo() {\n  return 2;\n}");
  });
});
