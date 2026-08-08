import type { Theme } from "@dst0/p";
import { matchesKey, truncateToWidth } from "@dst0/p-tui";
import { BaseOverlay } from "./baseoverlay.ts";

export class StackOverlayComponent extends BaseOverlay {
  private num: number;
  private position: string;
  private done: (result: string) => void;

  constructor(theme: Theme, num: number, position: string, done: (result: string) => void) {
    super(theme);
    this.num = num;
    this.position = position;
    this.done = done;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || matchesKey(data, "return")) {
      this.done(`Overlay ${this.num}`);
    }
  }

  render(width: number): string[] {
    const th = this.theme;
    // Use different colors for each overlay to show stacking
    const colors = ["error", "success", "accent"] as const;
    const color = colors[(this.num - 1) % colors.length]!;
    const innerW = Math.max(1, width - 2);
    const border = (char: string) => th.fg(color, char);
    const padLine = (s: string) => truncateToWidth(s, innerW, "...", true);
    const lines: string[] = [];

    lines.push(border(`╭${"─".repeat(innerW)}╮`));
    lines.push(border("│") + padLine(` Overlay ${th.fg("accent", `#${this.num}`)}`) + border("│"));
    lines.push(border("│") + padLine(` Layer: ${th.fg(color, this.position)}`) + border("│"));
    lines.push(border("│") + padLine("") + border("│"));
    // Add extra lines to make it taller
    for (let i = 0; i < 5; i++) {
      lines.push(border("│") + padLine(` ${"░".repeat(innerW - 2)} `) + border("│"));
    }
    lines.push(border("│") + padLine("") + border("│"));
    lines.push(border("│") + padLine(th.fg("dim", " Press Enter/Esc to close")) + border("│"));
    lines.push(border(`╰${"─".repeat(innerW)}╯`));

    return lines;
  }
}
