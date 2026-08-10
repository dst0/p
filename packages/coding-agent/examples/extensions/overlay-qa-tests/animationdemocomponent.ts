import type { Theme } from "@dst0/p";
import type { TUI } from "@dst0/p-tui";
import { matchesKey, truncateToWidth } from "@dst0/p-tui";
import { BaseOverlay } from "./baseoverlay.ts";
import { hslToRgb } from "./helpers.ts";

export class AnimationDemoComponent extends BaseOverlay {
  private tui: TUI;
  private frame = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private fps = 0;
  private lastFpsUpdate = Date.now();
  private framesSinceLastFps = 0;
  private done: () => void;

  constructor(tui: TUI, theme: Theme, done: () => void) {
    super(theme);
    this.tui = tui;
    this.done = done;
    this.startAnimation();
  }

  private startAnimation(): void {
    // Run at ~30 FPS (same as DOOM target)
    this.interval = setInterval(() => {
      this.frame++;
      this.framesSinceLastFps++;

      // Update FPS counter every second
      const now = Date.now();
      if (now - this.lastFpsUpdate >= 1000) {
        this.fps = this.framesSinceLastFps;
        this.framesSinceLastFps = 0;
        this.lastFpsUpdate = now;
      }

      this.tui.requestRender();
    }, 1000 / 30);
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.dispose();
      this.done();
    }
  }

  render(width: number): string[] {
    const th = this.theme;
    const innerW = Math.max(1, width - 2);
    const padLine = (s: string) => truncateToWidth(s, innerW, "...", true);
    const border = (c: string) => th.fg("border", c);

    const lines: string[] = [];
    lines.push(border(`╭${"─".repeat(innerW)}╮`));
    lines.push(border("│") + padLine(th.fg("accent", " Animation Demo (~30 FPS)")) + border("│"));
    lines.push(border("│") + padLine(``) + border("│"));
    lines.push(border("│") + padLine(` Frame: ${th.fg("accent", String(this.frame))}`) + border("│"));
    lines.push(border("│") + padLine(` FPS: ${th.fg("success", String(this.fps))}`) + border("│"));
    lines.push(border("│") + padLine(``) + border("│"));

    // Animated content - bouncing bar
    const barWidth = Math.max(12, innerW - 4); // Ensure enough space for bar
    const pos = Math.max(0, Math.floor(((Math.sin(this.frame / 10) + 1) * (barWidth - 10)) / 2));
    const bar = " ".repeat(pos) + th.fg("accent", "██████████") + " ".repeat(Math.max(0, barWidth - 10 - pos));
    lines.push(border("│") + padLine(` ${bar}`) + border("│"));

    // Spinning character
    const spinChars = ["◐", "◓", "◑", "◒"];
    const spin = spinChars[this.frame % spinChars.length];
    lines.push(border("│") + padLine(` Spinner: ${th.fg("warning", spin!)}`) + border("│"));

    // Color cycling
    const hue = (this.frame * 3) % 360;
    const rgb = hslToRgb(hue / 360, 0.8, 0.5);
    const colorBlock = `\x1b[48;2;${rgb[0]};${rgb[1]};${rgb[2]}m${"  ".repeat(10)}\x1b[0m`;
    lines.push(border("│") + padLine(` Color: ${colorBlock}`) + border("│"));

    lines.push(border("│") + padLine(``) + border("│"));
    lines.push(border("│") + padLine(th.fg("dim", " This proves overlays can handle")) + border("│"));
    lines.push(border("│") + padLine(th.fg("dim", " real-time game-like rendering.")) + border("│"));
    lines.push(border("│") + padLine(th.fg("dim", " (p-doom uses same approach)")) + border("│"));
    lines.push(border("│") + padLine(``) + border("│"));
    lines.push(border("│") + padLine(th.fg("dim", " Press Esc to close")) + border("│"));
    lines.push(border(`╰${"─".repeat(innerW)}╯`));

    return lines;
  }

  dispose(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}
