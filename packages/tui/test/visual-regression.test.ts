import { describe, it } from "node:test";
import { Box } from "../src/components/box.ts";
import { Input } from "../src/components/input.ts";
import { Markdown } from "../src/components/markdown.ts";
import { SelectList } from "../src/components/select-list.ts";
import { Text } from "../src/components/text.ts";
import type { Component } from "../src/tui.ts";
import { assertScrollVisualSnapshot, assertVisualSnapshot } from "./helpers/visual-snapshot.ts";
import { defaultMarkdownTheme, defaultSelectListTheme } from "./test-themes.ts";

class TestSequenceComponent implements Component {
  lines: string[] = [];
  render(_width: number): string[] {
    return this.lines;
  }
  invalidate(): void {}
}

describe("TUI Automated Visual Regression Tests", () => {
  it("renders Box component layout visually identical to baseline", async () => {
    const box = new Box(1, 1);
    box.addChild(new Text("Hello World - Visual Regression Test"));

    await assertVisualSnapshot(box, "box-component", { width: 40, height: 8 });
  });

  it("renders Markdown formatted text visually identical to baseline", async () => {
    const md = new Markdown(
      `# Title Header
This is a **bold text** and *italic text* paragraph.

- Item 1
- Item 2
- Item 3`,
      1,
      0,
      defaultMarkdownTheme,
    );

    await assertVisualSnapshot(md, "markdown-component", { width: 50, height: 10 });
  });

  it("renders SelectList component visually identical to baseline", async () => {
    const list = new SelectList(
      [
        { label: "Option 1 - Default Choice", value: "opt1" },
        { label: "Option 2 - Secondary Choice", value: "opt2" },
        { label: "Option 3 - Advanced Setting", value: "opt3" },
      ],
      5,
      defaultSelectListTheme,
    );

    await assertVisualSnapshot(list, "select-list-component", { width: 45, height: 6 });
  });

  it("renders Input prompt component visually identical to baseline", async () => {
    const input = new Input();
    input.setValue("Hello world query test");

    await assertVisualSnapshot(input, "input-component", { width: 50, height: 4 });
  });

  it("scrolls incremental sequence lines in-place without scrollback artifacts", async () => {
    const comp = new TestSequenceComponent();
    comp.lines = Array.from({ length: 30 }, (_, i) => `Line ${i + 1}: Sequence item payload value`);

    await assertScrollVisualSnapshot(comp, "scroll-sequence-shift", {
      width: 40,
      height: 10,
      action: (tui) => {
        // Append 10 more lines to simulate scrolling content down (viewport top shifts)
        comp.lines = [
          ...comp.lines,
          ...Array.from({ length: 10 }, (_, i) => `Line ${i + 31}: Sequence item payload value`),
        ];
        tui.requestRender();
      },
    });
  });

  it("scrolls with active overlay modal without scrollback artifacts", async () => {
    const comp = new TestSequenceComponent();
    comp.lines = Array.from({ length: 25 }, (_, i) => `Row ${i + 1}: Base screen content line`);

    const overlay = new TestSequenceComponent();
    overlay.lines = ["+-----------------------+", "| Active Overlay Modal  |", "+-----------------------+"];

    await assertScrollVisualSnapshot(comp, "scroll-with-overlay", {
      width: 40,
      height: 10,
      action: (tui) => {
        tui.showOverlay(overlay);
        comp.lines = [...comp.lines, ...Array.from({ length: 5 }, (_, i) => `Row ${i + 26}: Base screen content line`)];
        tui.requestRender();
      },
    });
  });
});
