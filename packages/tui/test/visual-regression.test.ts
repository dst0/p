import { describe, it } from "node:test";
import { Box } from "../src/components/box.ts";
import { Input } from "../src/components/input.ts";
import { Markdown } from "../src/components/markdown.ts";
import { SelectList } from "../src/components/select-list.ts";
import { Text } from "../src/components/text.ts";
import { assertVisualSnapshot } from "./helpers/visual-snapshot.ts";
import { defaultMarkdownTheme, defaultSelectListTheme } from "./test-themes.ts";

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
});
