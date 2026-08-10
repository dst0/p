import type { Theme } from "@dst0/p";
import { matchesKey } from "@dst0/p-tui";
import { BaseOverlay } from "./baseoverlay.ts";

export class MaxHeightTestComponent extends BaseOverlay {
  private done: () => void;

  constructor(theme: Theme, done: () => void) {
    super(theme);
    this.done = done;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.done();
    }
  }

  render(width: number): string[] {
    const th = this.theme;
    // Intentionally render 21 lines - maxHeight: 10 will truncate to first 10
    // You should see header + lines 1-6, with bottom border cut off
    const contentLines: string[] = [
      th.fg("warning", " ⚠ Rendering 21 lines, maxHeight: 10"),
      th.fg("dim", " Lines 11-21 truncated (no bottom border)"),
      "",
    ];

    for (let i = 1; i <= 14; i++) {
      contentLines.push(` Line ${i} of 14`);
    }

    contentLines.push("", th.fg("dim", " Press Esc to close"));

    return this.box(contentLines, width, "MaxHeight Test");
  }
}
