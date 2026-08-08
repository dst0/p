import type { RgbColor } from "../../terminal-colors.ts";
import type { TUI } from "../tui.ts";
import type { PendingOsc11BackgroundQuery } from "../types-part1.ts";

export function do_positionHardwareCursor(
  self: TUI,
  cursorPos: { row: number; col: number } | null,
  totalLines: number,
): void {
  if (!cursorPos || totalLines <= 0) {
    self.terminal.hideCursor();
    return;
  }

  // Clamp cursor position to valid range
  const targetRow = Math.max(0, Math.min(cursorPos.row, totalLines - 1));
  const targetCol = Math.max(0, cursorPos.col);

  // Move cursor from current position to target
  const rowDelta = targetRow - self.hardwareCursorRow;
  let buffer = "";
  if (rowDelta > 0) {
    buffer += `\x1b[${rowDelta}B`; // Move down
  } else if (rowDelta < 0) {
    buffer += `\x1b[${-rowDelta}A`; // Move up
  }
  // Move to absolute column (1-indexed)
  buffer += `\x1b[${targetCol + 1}G`;

  if (buffer) {
    self.terminal.write(buffer);
  }

  self.hardwareCursorRow = targetRow;
  if (self.showHardwareCursor) {
    self.terminal.showCursor();
  } else {
    self.terminal.hideCursor();
  }
}

export function do_queryTerminalBackgroundColor(
  self: TUI,
  { timeoutMs }: { timeoutMs: number },
): Promise<RgbColor | undefined> {
  return new Promise((resolve) => {
    const query: PendingOsc11BackgroundQuery = {
      settled: false,
      resolve,
      timer: undefined,
    };

    query.timer = setTimeout(() => {
      if (query.settled) {
        return;
      }
      query.settled = true;
      query.timer = undefined;
      query.resolve?.(undefined);
      query.resolve = undefined;
    }, timeoutMs);
    self.pendingOsc11BackgroundQueries.push(query);
    self.pendingOsc11BackgroundReplies += 1;
    self.terminal.write("\x1b]11;?\x07");
  });
}
