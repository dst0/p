import type { Theme } from "@dst0/p";
import type { TUI } from "@dst0/p-tui";
import { matchesKey } from "@dst0/p-tui";
import { BaseOverlay } from "./baseoverlay.ts";
import { globalToggleHandle } from "./constants.ts";

export class ToggleDemoComponent extends BaseOverlay {
  private tui: TUI;
  private toggleCount = 0;
  private isToggling = false;
  private done: () => void;

  constructor(tui: TUI, theme: Theme, done: () => void) {
    super(theme);
    this.tui = tui;
    this.done = done;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.done();
    } else if (matchesKey(data, "t") && globalToggleHandle && !this.isToggling) {
      // Demonstrate toggle by hiding for 1 second then showing again
      // (In real usage, a global keybinding would control visibility)
      this.isToggling = true;
      this.toggleCount++;
      globalToggleHandle.setHidden(true);

      // Auto-restore after 1 second to demonstrate the API
      setTimeout(() => {
        if (globalToggleHandle) {
          globalToggleHandle.setHidden(false);
          this.isToggling = false;
          this.tui.requestRender();
        }
      }, 1000);
    }
  }

  render(width: number): string[] {
    const th = this.theme;
    return this.box(
      [
        "",
        th.fg("accent", " Toggle Demo"),
        "",
        " This overlay demonstrates the",
        " onHandle callback API.",
        "",
        ` Toggle count: ${th.fg("accent", String(this.toggleCount))}`,
        "",
        th.fg("dim", " Press 't' to hide for 1 second"),
        th.fg("dim", " (demonstrates setHidden API)"),
        "",
        th.fg("dim", " In real usage, a global keybinding"),
        th.fg("dim", " would toggle visibility externally."),
        "",
        th.fg("dim", " Press Esc to close"),
        "",
      ],
      width,
      "Toggle Demo",
    );
  }
}
