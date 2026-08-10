import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isImageLine } from "../../terminal-image.ts";
import { isTermuxSession } from "../helpers.ts";
import type { TUI } from "../tui.ts";
import { renderIncremental } from "./incremental-render.ts";

export function do_doRender(self: TUI): void {
  if (self.stopped) return;
  const width = self.terminal.columns;
  const height = self.terminal.rows;
  const widthChanged = self.previousWidth !== 0 && self.previousWidth !== width;
  const heightChanged = self.previousHeight !== 0 && self.previousHeight !== height;
  const previousBufferLength = self.previousHeight > 0 ? self.previousViewportTop + self.previousHeight : height;
  const prevViewportTop = heightChanged ? Math.max(0, previousBufferLength - height) : self.previousViewportTop;
  const viewportTop = prevViewportTop;
  const hardwareCursorRow = self.hardwareCursorRow;
  const computeLineDiff = (targetRow: number): number => {
    const currentScreenRow = hardwareCursorRow - prevViewportTop;
    const targetScreenRow = targetRow - viewportTop;
    return targetScreenRow - currentScreenRow;
  };

  // Render all components to get new lines
  let newLines = self.render(width);

  // Composite overlays into the rendered lines (before differential compare)
  if (self.overlayStack.length > 0) {
    newLines = self.compositeOverlays(newLines, width, height);
  }

  // Extract cursor position before applying line resets (marker must be found first)
  const cursorPos = self.extractCursorPosition(newLines, height);

  newLines = self.applyLineResets(newLines);

  // Helper to clear scrollback and viewport and render all new lines
  const fullRender = (clear: boolean): void => {
    self.fullRedrawCount += 1;
    let buffer = "\x1b[?2026h"; // Begin synchronized output
    if (clear) {
      buffer += self.deleteKittyImages(self.previousKittyImageIds);
      buffer += "\x1b[2J\x1b[H\x1b[3J"; // Clear screen, home, then clear scrollback
    }
    for (let i = 0; i < newLines.length; i++) {
      if (i > 0) buffer += "\r\n";
      const line = newLines[i];
      const isImage = isImageLine(line);
      const imageReservedRows = isImage ? self.getKittyImageReservedRows(newLines, i) : 1;
      if (imageReservedRows > 1 && imageReservedRows <= height) {
        for (let row = 1; row < imageReservedRows; row++) {
          buffer += "\r\n";
        }
        buffer += `\x1b[${imageReservedRows - 1}A`;
        buffer += line;
        buffer += `\x1b[${imageReservedRows - 1}B`;
        i += imageReservedRows - 1;
        continue;
      }
      buffer += line;
    }
    buffer += "\x1b[?2026l"; // End synchronized output
    self.terminal.write(buffer);
    self.cursorRow = Math.max(0, newLines.length - 1);
    self.hardwareCursorRow = self.cursorRow;
    // Reset max lines when clearing, otherwise track growth
    if (clear) {
      self.maxLinesRendered = newLines.length;
    } else {
      self.maxLinesRendered = Math.max(self.maxLinesRendered, newLines.length);
    }
    const bufferLength = Math.max(height, newLines.length);
    self.previousViewportTop = Math.max(0, bufferLength - height);
    self.positionHardwareCursor(cursorPos, newLines.length);
    self.previousLines = newLines;
    self.previousKittyImageIds = self.collectKittyImageIds(newLines);
    self.previousWidth = width;
    self.previousHeight = height;
  };

  const debugRedraw = process.env.PI_DEBUG_REDRAW === "1";
  const logRedraw = (reason: string): void => {
    if (!debugRedraw) return;
    const logPath = path.join(os.homedir(), ".p", "agent", "pi-debug.log");
    const msg = `[${new Date().toISOString()}] fullRender: ${reason} (prev=${self.previousLines.length}, new=${newLines.length}, height=${height})\n`;
    fs.appendFileSync(logPath, msg);
  };

  // First render - just output everything without clearing (assumes clean screen)
  if (self.previousLines.length === 0 && !widthChanged && !heightChanged) {
    logRedraw("first render");
    fullRender(false);
    return;
  }

  // Width changes always need a full re-render because wrapping changes.
  if (widthChanged) {
    logRedraw(`terminal width changed (${self.previousWidth} -> ${width})`);
    fullRender(true);
    return;
  }

  // Height changes normally need a full re-render to keep the visible viewport aligned,
  // but Termux changes height when the software keyboard shows or hides.
  // In that environment, a full redraw causes the entire history to replay on every toggle.
  if (heightChanged && !isTermuxSession()) {
    logRedraw(`terminal height changed (${self.previousHeight} -> ${height})`);
    fullRender(true);
    return;
  }

  // Content shrunk below the working area and no overlays - re-render to clear empty rows
  // (overlays need the padding, so only do self when no overlays are active)
  // Configurable via setClearOnShrink() or PI_CLEAR_ON_SHRINK=0 env var
  if (self.clearOnShrink && newLines.length < self.maxLinesRendered && self.overlayStack.length === 0) {
    logRedraw(`clearOnShrink (maxLinesRendered=${self.maxLinesRendered})`);
    fullRender(true);
    return;
  }

  // When an overlay is active or was just active, redraw only the visible screen rows (last height lines)
  // with synchronized output without clearing scrollback history (\x1b[3J) or dumping screen to scrollback (\x1b[2J).
  const newViewportTop = Math.max(0, newLines.length - height);
  const visibleOverlayCount = self.overlayStack.filter((e) => self.isOverlayVisible(e)).length;
  const hasVisibleOverlay = visibleOverlayCount > 0;
  const hadVisibleOverlay = self.previousOverlayCount > 0;
  self.previousOverlayCount = visibleOverlayCount;

  if (hasVisibleOverlay || hadVisibleOverlay) {
    logRedraw(`overlay active redraw (has=${hasVisibleOverlay}, had=${hadVisibleOverlay})`);
    let buffer = "\x1b[?2026h\x1b[H";
    const visibleEnd = Math.min(newLines.length, newViewportTop + height);
    for (let i = newViewportTop; i < visibleEnd; i++) {
      buffer += "\x1b[2K";
      buffer += newLines[i];
      if (i < visibleEnd - 1) {
        buffer += "\r\n";
      }
    }
    const renderedCount = visibleEnd - newViewportTop;
    if (renderedCount === 0) {
      buffer += "\x1b[2K";
      for (let i = 1; i < height; i++) {
        buffer += "\r\n\x1b[2K";
      }
      if (height > 1) {
        buffer += `\x1b[${height - 1}A`;
      }
    } else if (renderedCount < height) {
      for (let i = renderedCount; i < height; i++) {
        buffer += "\r\n\x1b[2K";
      }
      const moveBack = height - renderedCount;
      if (moveBack > 0) {
        buffer += `\x1b[${moveBack}A`;
      }
    }
    buffer += "\x1b[?2026l";
    self.terminal.write(buffer);
    self.previousLines = newLines;
    self.previousKittyImageIds = self.collectKittyImageIds(newLines);
    self.previousWidth = width;
    self.previousHeight = height;
    self.previousViewportTop = newViewportTop;
    self.cursorRow = Math.max(0, visibleEnd - 1);
    self.hardwareCursorRow = self.cursorRow;
    self.maxLinesRendered = Math.max(self.maxLinesRendered, newLines.length);
    self.positionHardwareCursor(cursorPos, newLines.length);
    return;
  }

  renderIncremental(self, {
    computeLineDiff,
    cursorPos,
    fullRender,
    hardwareCursorRow,
    height,
    logRedraw,
    newLines,
    prevViewportTop,
    viewportTop,
    width,
  });
}
