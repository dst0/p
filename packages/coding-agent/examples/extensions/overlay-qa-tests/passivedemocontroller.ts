import type { Theme } from "@dst0/p";
import type { OverlayHandle, TUI } from "@dst0/p-tui";
import { matchesKey } from "@dst0/p-tui";
import { BaseOverlay } from "./baseoverlay.ts";
import { TimerPanel } from "./timerpanel.ts";

export class PassiveDemoController extends BaseOverlay {
  focused = false;
  private tui: TUI;
  private typed = "";
  private timerComponent: TimerPanel;
  private timerHandle: OverlayHandle | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private inputCount = 0;
  private lastInputDebug = "";
  private done: () => void;

  constructor(tui: TUI, theme: Theme, done: () => void) {
    super(theme);
    this.tui = tui;
    this.done = done;
    this.timerComponent = new TimerPanel(theme);
    this.timerHandle = this.tui.showOverlay(this.timerComponent, {
      nonCapturing: true,
      anchor: "top-right",
      width: 22,
      margin: { top: 1, right: 2 },
    });
    this.interval = setInterval(() => {
      this.timerComponent.tick();
      this.tui.requestRender();
    }, 1000);
  }

  handleInput(data: string): void {
    this.inputCount++;
    this.lastInputDebug = `len=${data.length} c0=${data.charCodeAt(0)}`;
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.cleanup();
      this.done();
    } else if (matchesKey(data, "backspace")) {
      this.typed = this.typed.slice(0, -1);
    } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
      this.typed += data;
    }
  }

  render(width: number): string[] {
    const th = this.theme;
    const display = this.typed.length > 0 ? this.typed : th.fg("dim", "(type here)");
    return this.box(
      [
        "",
        ` ${th.fg("dim", `focused=${this.focused} inputs=${this.inputCount}`)}`,
        ` ${th.fg("dim", `last: ${this.lastInputDebug || "none"}`)}`,
        "",
        ` > ${display}`,
        "",
        th.fg("dim", " Type to prove input goes here."),
        th.fg("dim", " Press Esc to close both."),
        "",
      ],
      width,
      "Non-Capturing Demo",
    );
  }

  private cleanup(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.timerHandle?.hide();
    this.timerHandle = null;
  }

  override dispose(): void {
    this.cleanup();
  }
}
