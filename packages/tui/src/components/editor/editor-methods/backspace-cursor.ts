import type { Editor } from "../editor.ts";

export function do_handleBackspace(self: Editor): void {
  self.exitHistoryBrowsing();
  self.lastAction = null;

  if (self.state.cursorCol > 0) {
    self.pushUndoSnapshot();

    // Delete grapheme before cursor (handles emojis, combining characters, etc.)
    const line = self.state.lines[self.state.cursorLine] || "";
    const beforeCursor = line.slice(0, self.state.cursorCol);

    // Find the last grapheme in the text before cursor
    const graphemes = [...self.segment(beforeCursor, "grapheme")];
    const lastGrapheme = graphemes[graphemes.length - 1];
    const graphemeLength = lastGrapheme ? lastGrapheme.segment.length : 1;

    const before = line.slice(0, self.state.cursorCol - graphemeLength);
    const after = line.slice(self.state.cursorCol);

    self.state.lines[self.state.cursorLine] = before + after;
    self.setCursorCol(self.state.cursorCol - graphemeLength);
  } else if (self.state.cursorLine > 0) {
    self.pushUndoSnapshot();

    // Merge with previous line
    const currentLine = self.state.lines[self.state.cursorLine] || "";
    const previousLine = self.state.lines[self.state.cursorLine - 1] || "";

    self.state.lines[self.state.cursorLine - 1] = previousLine + currentLine;
    self.state.lines.splice(self.state.cursorLine, 1);

    self.state.cursorLine--;
    self.setCursorCol(previousLine.length);
  }

  if (self.onChange) {
    self.onChange(self.getText());
  }

  // Update or re-trigger autocomplete after backspace
  if (self.autocompleteState) {
    self.updateAutocomplete();
  } else {
    // If autocomplete was cancelled (no matches), re-trigger if we're in a completable context
    const currentLine = self.state.lines[self.state.cursorLine] || "";
    const textBeforeCursor = currentLine.slice(0, self.state.cursorCol);
    // Slash command context
    if (self.isInSlashCommandContext(textBeforeCursor)) {
      self.tryTriggerAutocomplete();
    }
    // Symbol-based completion context like @, #, or provider triggers
    else if (self.autocompleteTriggerPattern.test(textBeforeCursor)) {
      self.tryTriggerAutocomplete();
    }
  }
}

export function do_setCursorCol(self: Editor, col: number): void {
  self.state.cursorCol = col;
  self.preferredVisualCol = null;
  self.snappedFromCursorCol = null;
}

export function do_moveToVisualLine(
  self: Editor,
  visualLines: Array<{ logicalLine: number; startCol: number; length: number }>,
  currentVisualLine: number,
  targetVisualLine: number,
): void {
  const currentVL = visualLines[currentVisualLine];
  const targetVL = visualLines[targetVisualLine];
  if (!(currentVL && targetVL)) return;

  // When the cursor was snapped to a segment start, resolve the pre-snap
  // position against the VL it belongs to. This gives the correct visual
  // column even after a resize reshuffles VLs.
  let currentVisualCol: number;
  if (self.snappedFromCursorCol !== null) {
    const vlIndex = self.findVisualLineAt(visualLines, currentVL.logicalLine, self.snappedFromCursorCol);
    currentVisualCol = self.snappedFromCursorCol - visualLines[vlIndex].startCol;
  } else {
    currentVisualCol = self.state.cursorCol - currentVL.startCol;
  }

  // For non-last segments, clamp to length-1 to stay within the segment
  const isLastSourceSegment =
    currentVisualLine === visualLines.length - 1 ||
    visualLines[currentVisualLine + 1]?.logicalLine !== currentVL.logicalLine;
  const sourceMaxVisualCol = isLastSourceSegment ? currentVL.length : Math.max(0, currentVL.length - 1);

  const isLastTargetSegment =
    targetVisualLine === visualLines.length - 1 ||
    visualLines[targetVisualLine + 1]?.logicalLine !== targetVL.logicalLine;
  const targetMaxVisualCol = isLastTargetSegment ? targetVL.length : Math.max(0, targetVL.length - 1);

  const moveToVisualCol = self.computeVerticalMoveColumn(currentVisualCol, sourceMaxVisualCol, targetMaxVisualCol);

  // Set cursor position
  self.state.cursorLine = targetVL.logicalLine;
  const targetCol = targetVL.startCol + moveToVisualCol;
  const logicalLine = self.state.lines[targetVL.logicalLine] || "";
  self.state.cursorCol = Math.min(targetCol, logicalLine.length);

  // Snap cursor to atomic segment boundary (e.g. paste markers)
  // so the cursor never lands in the middle of a multi-grapheme unit.
  // Single-grapheme segments don't need snapping.
  const segments = [...self.segment(logicalLine, "grapheme")];
  for (const seg of segments) {
    if (seg.index > self.state.cursorCol) break;
    if (seg.segment.length <= 1) continue;
    if (self.state.cursorCol < seg.index + seg.segment.length) {
      const isContinuation = seg.index < targetVL.startCol;
      const isMovingDown = targetVisualLine > currentVisualLine;

      if (isContinuation && isMovingDown) {
        // The segment started on a previous visual line, and we
        // already visited it on the way down. Skip all remaining
        // continuation VLs and land on the first VL past it.
        const segEnd = seg.index + seg.segment.length;
        let next = targetVisualLine + 1;
        while (
          next < visualLines.length &&
          visualLines[next].logicalLine === targetVL.logicalLine &&
          visualLines[next].startCol < segEnd
        ) {
          next++;
        }
        if (next < visualLines.length) {
          self.moveToVisualLine(visualLines, currentVisualLine, next);
          return;
        }
      }

      // Snap to the start of the segment so it gets highlighted.
      // Store the pre-snap position so the next vertical move can
      // resolve it to the correct visual column.
      self.snappedFromCursorCol = self.state.cursorCol;
      self.state.cursorCol = seg.index;
      return;
    }
  }

  // No snap occurred – we moved out of the atomic segment.
  self.snappedFromCursorCol = null;
}
