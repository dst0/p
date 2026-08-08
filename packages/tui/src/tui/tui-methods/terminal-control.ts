import { performance } from "node:perf_hooks";
import { formatOsc11BackgroundColor, formatOsc111ResetBackgroundColor } from "../../terminal-colors.ts";
import { getCapabilities } from "../../terminal-image.ts";
import { TUI } from "../tui.ts";

export function do_queryCellSize(self: TUI): void {
  // Only query if terminal supports images (cell size is only used for image rendering)
  if (!getCapabilities().images) {
    return;
  }
  // Query terminal for cell size in pixels: CSI 16 t
  // Response format: CSI 6 ; height ; width t
  self.terminal.write("\x1b[16t");
}

export function do_setTerminalBackgroundColor(self: TUI, colorHex?: string): void {
  if (self.currentBackgroundColorHex === colorHex) return;
  self.currentBackgroundColorHex = colorHex;
  if (colorHex) {
    self.terminal.write(formatOsc11BackgroundColor(colorHex));
  } else {
    self.terminal.write(formatOsc111ResetBackgroundColor());
  }
}

export function do_resetTerminalBackgroundColor(self: TUI): void {
  if (self.currentBackgroundColorHex !== undefined) {
    self.currentBackgroundColorHex = undefined;
    self.terminal.write(formatOsc111ResetBackgroundColor());
  }
}

export function do_stop(self: TUI): void {
  self.stopped = true;
  if (self.renderTimer) {
    clearTimeout(self.renderTimer);
    self.renderTimer = undefined;
  }
  self.resetTerminalBackgroundColor();
  // Move cursor to the end of the content to prevent overwriting/artifacts on exit
  if (self.previousLines.length > 0) {
    const targetRow = self.previousLines.length; // Line after the last content
    const lineDiff = targetRow - self.hardwareCursorRow;
    if (lineDiff > 0) {
      self.terminal.write(`\x1b[${lineDiff}B`);
    } else if (lineDiff < 0) {
      self.terminal.write(`\x1b[${-lineDiff}A`);
    }
    self.terminal.write("\r\n");
  }

  self.terminal.showCursor();
  self.terminal.stop();
}

export function do_requestRender(self: TUI, force = false): void {
  if (force) {
    self.previousLines = [];
    self.previousWidth = -1; // -1 triggers widthChanged, forcing a full clear
    self.previousHeight = -1; // -1 triggers heightChanged, forcing a full clear
    self.cursorRow = 0;
    self.hardwareCursorRow = 0;
    self.maxLinesRendered = 0;
    self.previousViewportTop = 0;
    if (self.renderTimer) {
      clearTimeout(self.renderTimer);
      self.renderTimer = undefined;
    }
    self.renderRequested = true;
    process.nextTick(() => {
      if (self.stopped || !self.renderRequested) {
        return;
      }
      self.renderRequested = false;
      self.lastRenderAt = performance.now();
      self.doRender();
    });
    return;
  }
  if (self.renderRequested) return;
  self.renderRequested = true;
  process.nextTick(() => self.scheduleRender());
}

export function do_scheduleRender(self: TUI): void {
  if (self.stopped || self.renderTimer || !self.renderRequested) {
    return;
  }
  const elapsed = performance.now() - self.lastRenderAt;
  const delay = Math.max(0, TUI.MIN_RENDER_INTERVAL_MS - elapsed);
  self.renderTimer = setTimeout(() => {
    self.renderTimer = undefined;
    if (self.stopped || !self.renderRequested) {
      return;
    }
    self.renderRequested = false;
    self.lastRenderAt = performance.now();
    self.doRender();
    if (self.renderRequested) {
      self.scheduleRender();
    }
  }, delay);
}
