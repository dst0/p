import assert from "node:assert";
import { describe, it } from "node:test";
import { SelectList } from "../src/components/select-list.ts";
import { visibleWidth } from "../src/utils.ts";

const testTheme = {
  selectedPrefix: (text: string) => text,
  selectedText: (text: string) => text,
  description: (text: string) => text,
  scrollInfo: (text: string) => text,
  noMatch: (text: string) => text,
};

const visibleIndexOf = (line: string, text: string): number => {
  const index = line.indexOf(text);
  assert.notEqual(index, -1);
  return visibleWidth(line.slice(0, index));
};

describe("SelectList", () => {
  it("normalizes multiline descriptions to single line", () => {
    const items = [
      {
        value: "test",
        label: "test",
        description: "Line one\nLine two\nLine three",
      },
    ];

    const list = new SelectList(items, 5, testTheme);
    const rendered = list.render(100);

    assert.ok(rendered.length > 0);
    assert.ok(!rendered[0].includes("\n"));
    assert.ok(rendered[0].includes("Line one Line two Line three"));
  });

  it("keeps descriptions aligned when the primary text is truncated", () => {
    const items = [
      { value: "short", label: "short", description: "short description" },
      {
        value: "very-long-command-name-that-needs-truncation",
        label: "very-long-command-name-that-needs-truncation",
        description: "long description",
      },
    ];

    const list = new SelectList(items, 5, testTheme);
    const rendered = list.render(80);

    assert.equal(visibleIndexOf(rendered[0], "short description"), visibleIndexOf(rendered[1], "long description"));
  });

  it("uses the configured minimum primary column width", () => {
    const items = [
      { value: "a", label: "a", description: "first" },
      { value: "bb", label: "bb", description: "second" },
    ];

    const list = new SelectList(items, 5, testTheme, {
      minPrimaryColumnWidth: 12,
      maxPrimaryColumnWidth: 20,
    });
    const rendered = list.render(80);

    assert.equal(rendered[0].indexOf("first"), 14);
    assert.equal(rendered[1].indexOf("second"), 14);
  });

  it("uses the configured maximum primary column width", () => {
    const items = [
      {
        value: "very-long-command-name-that-needs-truncation",
        label: "very-long-command-name-that-needs-truncation",
        description: "first",
      },
      { value: "short", label: "short", description: "second" },
    ];

    const list = new SelectList(items, 5, testTheme, {
      minPrimaryColumnWidth: 12,
      maxPrimaryColumnWidth: 20,
    });
    const rendered = list.render(80);

    assert.equal(visibleIndexOf(rendered[0], "first"), 22);
    assert.equal(visibleIndexOf(rendered[1], "second"), 22);
  });

  it("allows overriding primary truncation while preserving description alignment", () => {
    const items = [
      {
        value: "very-long-command-name-that-needs-truncation",
        label: "very-long-command-name-that-needs-truncation",
        description: "first",
      },
      { value: "short", label: "short", description: "second" },
    ];

    const list = new SelectList(items, 5, testTheme, {
      minPrimaryColumnWidth: 12,
      maxPrimaryColumnWidth: 12,
      truncatePrimary: ({ text, maxWidth }) => {
        if (text.length <= maxWidth) {
          return text;
        }

        return `${text.slice(0, Math.max(0, maxWidth - 1))}…`;
      },
    });
    const rendered = list.render(80);

    assert.ok(rendered[0].includes("…"));
    assert.equal(visibleIndexOf(rendered[0], "first"), visibleIndexOf(rendered[1], "second"));
  });

  it("filters items correctly", () => {
    const items = [
      { value: "apple", label: "Apple" },
      { value: "banana", label: "Banana" },
      { value: "cherry", label: "Cherry" },
    ];
    const list = new SelectList(items, 5, testTheme);

    list.setFilter("ban");
    const rendered = list.render(80);
    assert.equal(rendered.length, 1);
    assert.ok(rendered[0].includes("Banana"));

    // Setting an empty filter restores all items
    list.setFilter("");
    const renderedAll = list.render(80);
    assert.equal(renderedAll.length, 3);
  });

  it("handles input and wraps selection correctly", () => {
    const items = [
      { value: "1", label: "1" },
      { value: "2", label: "2" },
      { value: "3", label: "3" },
    ];
    const list = new SelectList(items, 5, testTheme);

    // Initial state: selectedIndex = 0
    assert.equal(list.getSelectedItem()?.value, "1");

    // Press up -> wraps to bottom
    list.handleInput("\x1b[A"); // Up arrow
    assert.equal(list.getSelectedItem()?.value, "3");

    // Press down -> wraps to top
    list.handleInput("\x1b[B"); // Down arrow
    assert.equal(list.getSelectedItem()?.value, "1");

    // Move down normally
    list.handleInput("\x1b[B");
    assert.equal(list.getSelectedItem()?.value, "2");
  });

  it("triggers onSelect and onCancel correctly", () => {
    const items = [{ value: "1", label: "1" }];
    const list = new SelectList(items, 5, testTheme);
    let selected: any = null;
    let cancelled = false;

    list.onSelect = (item) => {
      selected = item;
    };
    list.onCancel = () => {
      cancelled = true;
    };

    list.handleInput("\x1b"); // Escape
    assert.ok(cancelled);

    list.handleInput("\r"); // Enter
    assert.equal(selected?.value, "1");
  });

  it("renders no match when empty", () => {
    const list = new SelectList([], 5, testTheme);
    const rendered = list.render(80);
    assert.equal(rendered.length, 1);
    assert.ok(rendered[0].includes("No matching commands"));
  });

  it("does not crash on invalidate", () => {
    const list = new SelectList([], 5, testTheme);
    list.invalidate(); // noop, just cover it
  });

  it("setSelectedIndex clamps to valid range", () => {
    const items = [
      { value: "1", label: "1" },
      { value: "2", label: "2" },
    ];
    const list = new SelectList(items, 5, testTheme);

    list.setSelectedIndex(-5);
    assert.equal(list.getSelectedItem()?.value, "1");

    list.setSelectedIndex(5);
    assert.equal(list.getSelectedItem()?.value, "2");
  });

  it("shows scroll info when truncated", () => {
    const items = Array.from({ length: 10 }).map((_, i) => ({ value: `${i}`, label: `${i}` }));
    const list = new SelectList(items, 5, testTheme);

    // Move to index 7 to force start index > 0
    list.setSelectedIndex(7);
    const rendered = list.render(80);

    assert.ok(rendered.some((line) => line.includes("(8/10)")));
  });

  it("triggers onSelectionChange when selection changes", () => {
    const items = [
      { value: "1", label: "1" },
      { value: "2", label: "2" },
    ];
    const list = new SelectList(items, 5, testTheme);
    let changedTo: any = null;

    list.onSelectionChange = (item) => {
      changedTo = item;
    };

    list.handleInput("\x1b[B"); // Down arrow
    assert.equal(changedTo?.value, "2");
  });
});
