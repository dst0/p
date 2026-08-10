import { deleteKittyImage, isImageLine } from "../../terminal-image.ts";
import { normalizeTerminalOutput, sliceByColumn, visibleWidth } from "../../utils.ts";
import { extractKittyImageIds, extractKittyImageRows } from "../helpers.ts";
import { TUI } from "../tui.ts";

export function do_compositeOverlays(self: TUI, lines: string[], termWidth: number, termHeight: number): string[] {
  if (self.overlayStack.length === 0) return lines;
  const result = [...lines];

  // Pre-render all visible overlays and calculate positions
  const rendered: { overlayLines: string[]; row: number; col: number; w: number }[] = [];
  let minLinesNeeded = result.length;

  const visibleEntries = self.overlayStack.filter((e) => self.isOverlayVisible(e));
  visibleEntries.sort((a, b) => a.focusOrder - b.focusOrder);
  for (const entry of visibleEntries) {
    const { component, options } = entry;

    // Get layout with height=0 first to determine width and maxHeight
    // (width and maxHeight don't depend on overlay height)
    const { width, maxHeight } = self.resolveOverlayLayout(options, 0, termWidth, termHeight);

    // Render component at calculated width
    let overlayLines = component.render(width);

    // Apply maxHeight if specified
    if (maxHeight !== undefined && overlayLines.length > maxHeight) {
      overlayLines = overlayLines.slice(0, maxHeight);
    }

    // Get final row/col with actual overlay height
    const { row, col } = self.resolveOverlayLayout(options, overlayLines.length, termWidth, termHeight);

    rendered.push({ overlayLines, row, col, w: width });
    minLinesNeeded = Math.max(minLinesNeeded, row + overlayLines.length);
  }

  // Pad to at least terminal height so overlays have screen-relative positions.
  // Excludes maxLinesRendered: the historical high-water mark caused self-reinforcing
  // inflation that pushed content into scrollback on terminal widen.
  const workingHeight = Math.max(result.length, termHeight, minLinesNeeded);

  // Extend result with empty lines if content is too short for overlay placement or working area
  while (result.length < workingHeight) {
    result.push("");
  }

  const viewportStart = Math.max(0, workingHeight - termHeight);

  // Composite each overlay
  for (const { overlayLines, row, col, w } of rendered) {
    for (let i = 0; i < overlayLines.length; i++) {
      const idx = viewportStart + row + i;
      if (idx >= 0 && idx < result.length) {
        // Defensive: truncate overlay line to declared width before compositing
        // (components should already respect width, but self ensures it)
        const truncatedOverlayLine =
          visibleWidth(overlayLines[i]) > w ? sliceByColumn(overlayLines[i], 0, w, true) : overlayLines[i];
        result[idx] = self.compositeLineAt(result[idx], truncatedOverlayLine, col, w, termWidth);
      }
    }
  }

  return result;
}

export function do_applyLineResets(_self: TUI, lines: string[]): string[] {
  const reset = TUI.SEGMENT_RESET;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!isImageLine(line)) {
      lines[i] = normalizeTerminalOutput(line) + reset;
    }
  }
  return lines;
}

export function do_collectKittyImageIds(_self: TUI, lines: string[]): Set<number> {
  const ids = new Set<number>();
  for (const line of lines) {
    for (const id of extractKittyImageIds(line)) {
      ids.add(id);
    }
  }
  return ids;
}

export function do_deleteKittyImages(_self: TUI, ids: Iterable<number>): string {
  let buffer = "";
  for (const id of ids) {
    buffer += deleteKittyImage(id);
  }
  return buffer;
}

export function do_getKittyImageReservedRows(
  _self: TUI,
  lines: string[],
  index: number,
  maxIndex = lines.length - 1,
): number {
  const rows = extractKittyImageRows(lines[index] ?? "");
  if (rows <= 1) return 1;

  const maxRows = Math.min(rows, maxIndex - index + 1, lines.length - index);
  let reservedRows = 1;
  while (reservedRows < maxRows) {
    const line = lines[index + reservedRows] ?? "";
    if (isImageLine(line) || visibleWidth(line) > 0) break;
    reservedRows++;
  }
  return reservedRows;
}

export function do_expandChangedRangeForKittyImages(
  self: TUI,
  firstChanged: number,
  lastChanged: number,
  newLines: string[],
): { firstChanged: number; lastChanged: number } {
  let expandedFirstChanged = firstChanged;
  let expandedLastChanged = lastChanged;
  const expandForLines = (lines: string[]): void => {
    for (let i = 0; i < lines.length; i++) {
      if (extractKittyImageIds(lines[i]).length === 0) continue;
      const blockEnd = i + self.getKittyImageReservedRows(lines, i) - 1;
      if (i >= firstChanged || (i <= lastChanged && blockEnd >= firstChanged)) {
        expandedFirstChanged = Math.min(expandedFirstChanged, i);
        expandedLastChanged = Math.max(expandedLastChanged, blockEnd);
      }
    }
  };

  expandForLines(self.previousLines);
  expandForLines(newLines);
  return { firstChanged: expandedFirstChanged, lastChanged: expandedLastChanged };
}

export function do_deleteChangedKittyImages(self: TUI, firstChanged: number, lastChanged: number): string {
  if (firstChanged < 0 || lastChanged < firstChanged) return "";

  const ids = new Set<number>();
  const maxLine = Math.min(lastChanged, self.previousLines.length - 1);
  for (let i = firstChanged; i <= maxLine; i++) {
    for (const id of extractKittyImageIds(self.previousLines[i] ?? "")) {
      ids.add(id);
    }
  }

  return self.deleteKittyImages(ids);
}
