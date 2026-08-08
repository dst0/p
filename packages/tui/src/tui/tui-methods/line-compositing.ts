import { isImageLine } from "../../terminal-image.ts";
import { extractSegments, sliceByColumn, sliceWithWidth, visibleWidth } from "../../utils.ts";
import { CURSOR_MARKER } from "../constants.ts";
import { TUI } from "../tui.ts";

export function do_compositeLineAt(
  _self: TUI,
  baseLine: string,
  overlayLine: string,
  startCol: number,
  overlayWidth: number,
  totalWidth: number,
): string {
  if (isImageLine(baseLine)) return baseLine;

  // Single pass through baseLine extracts both before and after segments
  const afterStart = startCol + overlayWidth;
  const base = extractSegments(baseLine, startCol, afterStart, totalWidth - afterStart, true);

  // Extract overlay with width tracking (strict=true to exclude wide chars at boundary)
  const overlay = sliceWithWidth(overlayLine, 0, overlayWidth, true);

  // Pad segments to target widths
  const beforePad = Math.max(0, startCol - base.beforeWidth);
  const overlayPad = Math.max(0, overlayWidth - overlay.width);
  const actualBeforeWidth = Math.max(startCol, base.beforeWidth);
  const actualOverlayWidth = Math.max(overlayWidth, overlay.width);
  const afterTarget = Math.max(0, totalWidth - actualBeforeWidth - actualOverlayWidth);
  const afterPad = Math.max(0, afterTarget - base.afterWidth);

  // Compose result
  const r = TUI.SEGMENT_RESET;
  const result =
    base.before +
    " ".repeat(beforePad) +
    r +
    overlay.text +
    " ".repeat(overlayPad) +
    r +
    base.after +
    " ".repeat(afterPad) +
    r;

  // CRITICAL: Always verify and truncate to terminal width.
  // This is the final safeguard against width overflow which would crash the TUI.
  // Width tracking can drift from actual visible width due to:
  // - Complex ANSI/OSC sequences (hyperlinks, colors)
  // - Wide characters at segment boundaries
  // - Edge cases in segment extraction
  const resultWidth = visibleWidth(result);
  if (resultWidth <= totalWidth) {
    return result;
  }
  // Truncate with strict=true to ensure we don't exceed totalWidth
  return sliceByColumn(result, 0, totalWidth, true);
}

export function do_extractCursorPosition(
  _self: TUI,
  lines: string[],
  height: number,
): { row: number; col: number } | null {
  // Only scan the bottom `height` lines (visible viewport)
  const viewportTop = Math.max(0, lines.length - height);
  for (let row = lines.length - 1; row >= viewportTop; row--) {
    const line = lines[row];
    const markerIndex = line.indexOf(CURSOR_MARKER);
    if (markerIndex !== -1) {
      // Calculate visual column (width of text before marker)
      const beforeMarker = line.slice(0, markerIndex);
      const col = visibleWidth(beforeMarker);

      // Strip marker from the line
      lines[row] = line.slice(0, markerIndex) + line.slice(markerIndex + CURSOR_MARKER.length);

      return { row, col };
    }
  }
  return null;
}
