import type { Theme } from "@dst0/p";
import type { TUI } from "@dst0/p-tui";
import { matchesKey, truncateToWidth, visibleWidth } from "@dst0/p-tui";
import { spawn } from "child_process";
import { BaseOverlay } from "./baseoverlay.ts";

export class StreamingOverflowComponent extends BaseOverlay {
  private tui: TUI;
  private lines: string[] = [];
  private proc: ReturnType<typeof spawn> | null = null;
  private scrollOffset = 0;
  private maxVisibleLines = 15;
  private finished = false;
  private disposed = false;
  private done: () => void;

  constructor(tui: TUI, theme: Theme, done: () => void) {
    super(theme);
    this.tui = tui;
    this.done = done;
    this.startProcess();
  }

  private startProcess(): void {
    // Run a command that produces many lines with ANSI colors
    // Using find with -ls produces file listings, or use ls --color
    this.proc = spawn("bash", [
      "-c",
      `
			echo "Starting streaming overflow test (30+ seconds)..."
			echo "This simulates subagent output with colors, hyperlinks, and long paths"
			echo ""
			for i in $(seq 1 100); do
				# Simulate long file paths with OSC 8 hyperlinks (clickable) - tests width overflow
				DIR="/Users/nicobailon/Documents/development/p-mono/packages/coding-agent/src/modes/interactive"
				FILE="\${DIR}/components/very-long-component-name-that-exceeds-width-\${i}.ts"
				echo -e "\\033]8;;file://\${FILE}\\007▶ read: \${FILE}\\033]8;;\\007"

				# Add some colored status messages with long text
				if [ $((i % 5)) -eq 0 ]; then
					echo -e "  \\033[32m✓ Successfully processed \${i} files in /Users/nicobailon/Documents/development/p-mono\\033[0m"
				fi
				if [ $((i % 7)) -eq 0 ]; then
					echo -e "  \\033[33m⚠ Warning: potential issue detected at line \${i} in very-long-component-name-that-exceeds-width.ts\\033[0m"
				fi
				if [ $((i % 11)) -eq 0 ]; then
					echo -e "  \\033[31m✗ Error: file not found /some/really/long/path/that/definitely/exceeds/the/overlay/width/limit/file-\${i}.ts\\033[0m"
				fi
				sleep 0.3
			done
			echo ""
			echo -e "\\033[32m✓ Complete - 100 files processed in 30 seconds\\033[0m"
			echo "Press Esc to close"
			`,
    ]);

    this.proc.stdout?.on("data", (data: Buffer) => {
      if (this.disposed) return; // Guard against callbacks after dispose
      const text = data.toString();
      const newLines = text.split("\n");
      for (const line of newLines) {
        if (line) this.lines.push(line);
      }
      // Auto-scroll to bottom
      this.scrollOffset = Math.max(0, this.lines.length - this.maxVisibleLines);
      this.tui.requestRender();
    });

    this.proc.stderr?.on("data", (data: Buffer) => {
      if (this.disposed) return; // Guard against callbacks after dispose
      this.lines.push(this.theme.fg("error", data.toString().trim()));
      this.tui.requestRender();
    });

    this.proc.on("close", () => {
      if (this.disposed) return; // Guard against callbacks after dispose
      this.finished = true;
      this.tui.requestRender();
    });
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.proc?.kill();
      this.done();
    } else if (matchesKey(data, "up")) {
      this.scrollOffset = Math.max(0, this.scrollOffset - 1);
      this.tui.requestRender(); // Trigger re-render after scroll
    } else if (matchesKey(data, "down")) {
      this.scrollOffset = Math.min(Math.max(0, this.lines.length - this.maxVisibleLines), this.scrollOffset + 1);
      this.tui.requestRender(); // Trigger re-render after scroll
    }
  }

  render(width: number): string[] {
    const th = this.theme;
    const innerW = Math.max(1, width - 2);
    const padLine = (s: string) => truncateToWidth(s, innerW, "...", true);
    const border = (c: string) => th.fg("border", c);

    const result: string[] = [];
    const title = truncateToWidth(` Streaming Output (${this.lines.length} lines) `, innerW);
    const titlePad = Math.max(0, innerW - visibleWidth(title));
    result.push(border("╭") + th.fg("accent", title) + border(`${"─".repeat(titlePad)}╮`));

    // Scroll indicators
    const canScrollUp = this.scrollOffset > 0;
    const canScrollDown = this.scrollOffset < this.lines.length - this.maxVisibleLines;
    const scrollInfo = `↑${this.scrollOffset} | ↓${Math.max(0, this.lines.length - this.maxVisibleLines - this.scrollOffset)}`;

    result.push(
      border("│") + padLine(canScrollUp || canScrollDown ? th.fg("dim", ` ${scrollInfo}`) : "") + border("│"),
    );

    // Visible lines - truncate long lines to fit within border
    const visibleLines = this.lines.slice(this.scrollOffset, this.scrollOffset + this.maxVisibleLines);
    for (const line of visibleLines) {
      result.push(border("│") + padLine(` ${line}`) + border("│"));
    }

    // Pad to maxVisibleLines
    for (let i = visibleLines.length; i < this.maxVisibleLines; i++) {
      result.push(border("│") + padLine("") + border("│"));
    }

    const status = this.finished ? th.fg("success", "✓ Done") : th.fg("warning", "● Running");
    result.push(border("│") + padLine(` ${status} ${th.fg("dim", "| ↑↓ scroll | Esc close")}`) + border("│"));
    result.push(border(`╰${"─".repeat(innerW)}╯`));

    return result;
  }

  dispose(): void {
    this.disposed = true;
    this.proc?.kill();
  }
}
