import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isImageLine } from "../../terminal-image.ts";
import { visibleWidth } from "../../utils.ts";
import { isTermuxSession } from "../helpers.ts";
import type { TUI } from "../tui.ts";

export function do_doRender(self: TUI): void {
  if (self.stopped) return;
  const width = self.terminal.columns;
  const height = self.terminal.rows;
  const widthChanged = self.previousWidth !== 0 && self.previousWidth !== width;
  const heightChanged = self.previousHeight !== 0 && self.previousHeight !== height;
  const previousBufferLength = self.previousHeight > 0 ? self.previousViewportTop + self.previousHeight : height;
  let prevViewportTop = heightChanged ? Math.max(0, previousBufferLength - height) : self.previousViewportTop;
  let viewportTop = prevViewportTop;
  let hardwareCursorRow = self.hardwareCursorRow;
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

  // Find first and last changed lines
  let firstChanged = -1;
  let lastChanged = -1;
  const maxLines = Math.max(newLines.length, self.previousLines.length);
  for (let i = 0; i < maxLines; i++) {
    const oldLine = i < self.previousLines.length ? self.previousLines[i] : "";
    const newLine = i < newLines.length ? newLines[i] : "";

    if (oldLine !== newLine) {
      if (firstChanged === -1) {
        firstChanged = i;
      }
      lastChanged = i;
    }
  }
  const appendedLines = newLines.length > self.previousLines.length;
  if (appendedLines) {
    if (firstChanged === -1) {
      firstChanged = self.previousLines.length;
    }
    lastChanged = newLines.length - 1;
  }
  if (firstChanged !== -1) {
    const expandedRange = self.expandChangedRangeForKittyImages(firstChanged, lastChanged, newLines);
    firstChanged = expandedRange.firstChanged;
    lastChanged = expandedRange.lastChanged;
  }
  const appendStart = appendedLines && firstChanged === self.previousLines.length && firstChanged > 0;

  // No changes - but still need to update hardware cursor position if it moved
  if (firstChanged === -1) {
    self.positionHardwareCursor(cursorPos, newLines.length);
    self.previousViewportTop = prevViewportTop;
    self.previousHeight = height;
    return;
  }

  // All changes are in deleted lines (nothing to render, just clear)
  if (firstChanged >= newLines.length) {
    if (self.previousLines.length > newLines.length) {
      let buffer = "\x1b[?2026h";
      buffer += self.deleteChangedKittyImages(firstChanged, lastChanged);
      // Move to end of new content (clamp to 0 for empty content)
      const targetRow = Math.max(0, newLines.length - 1);
      if (targetRow < prevViewportTop) {
        logRedraw(`deleted lines moved viewport up (${targetRow} < ${prevViewportTop})`);
        fullRender(true);
        return;
      }
      const lineDiff = computeLineDiff(targetRow);
      if (lineDiff > 0) buffer += `\x1b[${lineDiff}B`;
      else if (lineDiff < 0) buffer += `\x1b[${-lineDiff}A`;
      buffer += "\r";
      // Clear extra lines without scrolling
      const extraLines = self.previousLines.length - newLines.length;
      if (extraLines > height) {
        logRedraw(`extraLines > height (${extraLines} > ${height})`);
        fullRender(true);
        return;
      }
      const clearStartOffset = newLines.length === 0 ? 0 : 1;
      if (extraLines > 0 && clearStartOffset > 0) {
        buffer += `\x1b[${clearStartOffset}B`;
      }
      for (let i = 0; i < extraLines; i++) {
        buffer += "\r\x1b[2K";
        if (i < extraLines - 1) buffer += "\x1b[1B";
      }
      const moveBack = Math.max(0, extraLines - 1 + clearStartOffset);
      if (moveBack > 0) {
        buffer += `\x1b[${moveBack}A`;
      }
      buffer += "\x1b[?2026l";
      self.terminal.write(buffer);
      self.cursorRow = targetRow;
      self.hardwareCursorRow = targetRow;
    }
    self.positionHardwareCursor(cursorPos, newLines.length);
    self.previousLines = newLines;
    self.previousKittyImageIds = self.collectKittyImageIds(newLines);
    self.previousWidth = width;
    self.previousHeight = height;
    self.previousViewportTop = prevViewportTop;
    return;
  }

  // Differential rendering can only touch what was actually visible.
  // If the first changed line is above the previous viewport, redraw only the visible screen rows
  // without clearing scrollback (\x1b[3J) or replaying the full history into stdout / dumping visible screen (\x1b[2J).
  if (firstChanged < prevViewportTop) {
    logRedraw(`firstChanged < viewportTop (${firstChanged} < ${prevViewportTop})`);
    self.fullRedrawCount += 1;
    // Preserve the user's scroll position by adjusting for lines added/removed above the viewport.
    // Do NOT scroll to bottom just because content above changed (e.g., tool output expansion).
    const lineDelta = newLines.length - self.previousLines.length;
    const newViewportTop = Math.max(0, Math.min(prevViewportTop + lineDelta, Math.max(0, newLines.length - height)));
    let buffer = "\x1b[?2026h\x1b[H";
    buffer += self.deleteChangedKittyImages(0, newLines.length - 1);
    const visibleEnd = Math.min(newLines.length, newViewportTop + height);
    for (let i = newViewportTop; i < visibleEnd; i++) {
      buffer += "\x1b[2K";
      buffer += newLines[i];
      if (i < visibleEnd - 1) {
        buffer += "\r\n";
      }
    }
    const renderedCount = visibleEnd - newViewportTop;
    if (renderedCount < height) {
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

  // Render from first changed line to end
  // Build buffer with all updates wrapped in synchronized output
  let buffer = "\x1b[?2026h"; // Begin synchronized output
  buffer += self.deleteChangedKittyImages(firstChanged, lastChanged);
  const prevViewportBottom = prevViewportTop + height - 1;
  const moveTargetRow = appendStart ? firstChanged - 1 : firstChanged;
  if (moveTargetRow > prevViewportBottom) {
    const currentScreenRow = Math.max(0, Math.min(height - 1, hardwareCursorRow - prevViewportTop));
    const moveToBottom = height - 1 - currentScreenRow;
    if (moveToBottom > 0) {
      buffer += `\x1b[${moveToBottom}B`;
    }
    const scroll = moveTargetRow - prevViewportBottom;
    buffer += "\r\n".repeat(scroll);
    prevViewportTop += scroll;
    viewportTop += scroll;
    hardwareCursorRow = moveTargetRow;
  }

  // Move cursor to first changed line (use hardwareCursorRow for actual position)
  const lineDiff = computeLineDiff(moveTargetRow);
  if (lineDiff > 0) {
    buffer += `\x1b[${lineDiff}B`; // Move down
  } else if (lineDiff < 0) {
    buffer += `\x1b[${-lineDiff}A`; // Move up
  }

  buffer += appendStart ? "\r\n" : "\r"; // Move to column 0

  // Only render changed lines (firstChanged to lastChanged), not all lines to end
  // This reduces flicker when only a single line changes (e.g., spinner animation)
  const renderEnd = Math.min(lastChanged, newLines.length - 1);
  for (let i = firstChanged; i <= renderEnd; i++) {
    if (i > firstChanged) buffer += "\r\n";
    const line = newLines[i];
    const isImage = isImageLine(line);
    const imageReservedRows = isImage ? self.getKittyImageReservedRows(newLines, i, renderEnd) : 1;
    if (imageReservedRows > 1) {
      const imageStartScreenRow = i - viewportTop;
      if (imageStartScreenRow < 0 || imageStartScreenRow + imageReservedRows > height) {
        logRedraw(`kitty image pre-clear would scroll (${imageStartScreenRow} + ${imageReservedRows} > ${height})`);
        fullRender(true);
        return;
      }

      buffer += "\x1b[2K";
      for (let row = 1; row < imageReservedRows; row++) {
        buffer += "\r\n\x1b[2K";
      }
      buffer += `\x1b[${imageReservedRows - 1}A`;
      buffer += line;
      buffer += `\x1b[${imageReservedRows - 1}B`;
      i += imageReservedRows - 1;
      continue;
    }

    buffer += "\x1b[2K"; // Clear current line
    if (!isImage && visibleWidth(line) > width) {
      // Log all lines to crash file for debugging
      const crashLogPath = path.join(os.homedir(), ".p", "agent", "pi-crash.log");
      const crashData = [
        `Crash at ${new Date().toISOString()}`,
        `Terminal width: ${width}`,
        `Line ${i} visible width: ${visibleWidth(line)}`,
        "",
        "=== All rendered lines ===",
        ...newLines.map((l, idx) => `[${idx}] (w=${visibleWidth(l)}) ${l}`),
        "",
      ].join("\n");
      fs.mkdirSync(path.dirname(crashLogPath), { recursive: true });
      fs.writeFileSync(crashLogPath, crashData);

      // Clean up terminal state before throwing
      self.stop();

      const errorMsg = [
        `Rendered line ${i} exceeds terminal width (${visibleWidth(line)} > ${width}).`,
        "",
        "This is likely caused by a custom TUI component not truncating its output.",
        "Use visibleWidth() to measure and truncateToWidth() to truncate lines.",
        "",
        `Debug log written to: ${crashLogPath}`,
      ].join("\n");
      throw new Error(errorMsg);
    }
    buffer += line;
  }

  // Track where cursor ended up after rendering
  let finalCursorRow = renderEnd;

  // If we had more lines before, clear them and move cursor back
  if (self.previousLines.length > newLines.length) {
    // Move to end of new content first if we stopped before it
    if (renderEnd < newLines.length - 1) {
      const moveDown = newLines.length - 1 - renderEnd;
      buffer += `\x1b[${moveDown}B`;
      finalCursorRow = newLines.length - 1;
    }
    const extraLines = self.previousLines.length - newLines.length;
    for (let i = newLines.length; i < self.previousLines.length; i++) {
      buffer += "\r\n\x1b[2K";
    }
    // Move cursor back to end of new content
    buffer += `\x1b[${extraLines}A`;
  }

  buffer += "\x1b[?2026l"; // End synchronized output

  if (process.env.PI_TUI_DEBUG === "1") {
    const debugDir = "/tmp/tui";
    fs.mkdirSync(debugDir, { recursive: true });
    const debugPath = path.join(debugDir, `render-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);
    const debugData = [
      `firstChanged: ${firstChanged}`,
      `viewportTop: ${viewportTop}`,
      `cursorRow: ${self.cursorRow}`,
      `height: ${height}`,
      `lineDiff: ${lineDiff}`,
      `hardwareCursorRow: ${hardwareCursorRow}`,
      `renderEnd: ${renderEnd}`,
      `finalCursorRow: ${finalCursorRow}`,
      `cursorPos: ${JSON.stringify(cursorPos)}`,
      `newLines.length: ${newLines.length}`,
      `previousLines.length: ${self.previousLines.length}`,
      "",
      "=== newLines ===",
      JSON.stringify(newLines, null, 2),
      "",
      "=== previousLines ===",
      JSON.stringify(self.previousLines, null, 2),
      "",
      "=== buffer ===",
      JSON.stringify(buffer),
    ].join("\n");
    fs.writeFileSync(debugPath, debugData);
  }

  // Write entire buffer at once
  self.terminal.write(buffer);

  // Track cursor position for next render
  // cursorRow tracks end of content (for viewport calculation)
  // hardwareCursorRow tracks actual terminal cursor position (for movement)
  self.cursorRow = Math.max(0, newLines.length - 1);
  self.hardwareCursorRow = finalCursorRow;
  // Track terminal's working area (grows but doesn't shrink unless cleared)
  self.maxLinesRendered = Math.max(self.maxLinesRendered, newLines.length);
  self.previousViewportTop = Math.max(prevViewportTop, finalCursorRow - height + 1);

  // Position hardware cursor for IME
  self.positionHardwareCursor(cursorPos, newLines.length);

  self.previousLines = newLines;
  self.previousKittyImageIds = self.collectKittyImageIds(newLines);
  self.previousWidth = width;
  self.previousHeight = height;
}
