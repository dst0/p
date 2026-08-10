import type { Theme } from "@dst0/p";
import { matchesKey } from "@dst0/p-tui";
import { BaseOverlay } from "./baseoverlay.ts";

export class PercentTestComponent extends BaseOverlay {
  private config: { name: string; row: number; col: number };
  private done: (result: "next" | "close") => void;

  constructor(
    theme: Theme,
    config: { name: string; row: number; col: number },
    done: (result: "next" | "close") => void,
  ) {
    super(theme);
    this.config = config;
    this.done = done;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.done("close");
    } else if (matchesKey(data, "space") || matchesKey(data, "right")) {
      this.done("next");
    }
  }

  render(width: number): string[] {
    const th = this.theme;
    return this.box(
      [
        "",
        ` ${th.fg("accent", this.config.name)}`,
        "",
        ` ${th.fg("dim", "Space/→ = next")}`,
        ` ${th.fg("dim", "Esc = close")}`,
        "",
      ],
      width,
      "Percent Test",
    );
  }
}
