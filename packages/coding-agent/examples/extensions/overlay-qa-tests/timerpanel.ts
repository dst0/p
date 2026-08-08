import { BaseOverlay } from "./baseoverlay.ts";

export class TimerPanel extends BaseOverlay {
  private seconds = 0;

  tick(): void {
    this.seconds++;
  }

  render(width: number): string[] {
    const th = this.theme;
    const mins = Math.floor(this.seconds / 60);
    const secs = this.seconds % 60;
    const time = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    return this.box([` ${th.fg("accent", time)}`, th.fg("dim", " nonCapturing: true")], width, "Timer");
  }
}
