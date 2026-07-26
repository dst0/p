import { Box, Container, Markdown, type MarkdownTheme } from "@dst0/p-tui";
import { getMarkdownTheme, theme } from "../theme/theme.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

/**
 * Component that renders a user message
 */
export class UserMessageComponent extends Container {
  private text: string;
  private contentBox: Box;

  constructor(text: string, markdownTheme: MarkdownTheme = getMarkdownTheme()) {
    super();
    this.text = text;
    this.contentBox = new Box(
      1,
      1,
      (content: string) => theme.bg("userMessageBg", content),
      (content: string) => theme.fg("accent", content),
    );
    this.rebuild(markdownTheme);
    this.addChild(this.contentBox);
  }

  override invalidate(): void {
    super.invalidate();
    this.rebuild(getMarkdownTheme());
  }

  private rebuild(markdownTheme: MarkdownTheme): void {
    this.contentBox.clear();
    this.contentBox.addChild(
      new Markdown(
        this.text,
        0,
        0,
        markdownTheme,
        {
          color: (content: string) => theme.fg("userMessageText", content),
        },
        { preserveOrderedListMarkers: true },
      ),
    );
  }

  override render(width: number): string[] {
    const lines = super.render(width);
    if (lines.length === 0) {
      return lines;
    }

    lines[0] = OSC133_ZONE_START + lines[0];
    lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
    return lines;
  }
}
