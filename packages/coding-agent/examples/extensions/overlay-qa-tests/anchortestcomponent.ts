import type { Theme } from "@dst0/p";
import type { OverlayAnchor } from "@dst0/p-tui";
import { matchesKey } from "@dst0/p-tui";
import { BaseOverlay } from "./baseoverlay.ts";

export class AnchorTestComponent extends BaseOverlay {
  private anchor: OverlayAnchor;
  private done: (result: "next" | "confirm" | "cancel") => void;

  constructor(theme: Theme, anchor: OverlayAnchor, done: (result: "next" | "confirm" | "cancel") => void) {
    super(theme);
    this.anchor = anchor;
    this.done = done;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.done("cancel");
    } else if (matchesKey(data, "return")) {
      this.done("confirm");
    } else if (matchesKey(data, "space") || matchesKey(data, "right")) {
      this.done("next");
    }
  }

  render(width: number): string[] {
    const th = this.theme;
    return this.box(
      [
        "",
        ` Current: ${th.fg("accent", this.anchor)}`,
        "",
        ` ${th.fg("dim", "Space/→ = next anchor")}`,
        ` ${th.fg("dim", "Enter = confirm")}`,
        ` ${th.fg("dim", "Esc = cancel")}`,
        "",
      ],
      width,
      "Anchor Test",
    );
  }
}
