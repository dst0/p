import { visibleWidth } from "../../../utils.ts";
import type { Editor } from "../editor.ts";
import { wordWrapLine } from "../helpers-part1.ts";

export function do_deleteWordForward(self: Editor): void {
  self.exitHistoryBrowsing();

  const currentLine = self.state.lines[self.state.cursorLine] || "";

  // If at end of line, merge with next line (delete the newline)
  if (self.state.cursorCol >= currentLine.length) {
    if (self.state.cursorLine < self.state.lines.length - 1) {
      self.pushUndoSnapshot();

      // Treat newline as deleted text (forward deletion = append)
      self.killRing.push("\n", { prepend: false, accumulate: self.lastAction === "kill" });
      self.lastAction = "kill";

      const nextLine = self.state.lines[self.state.cursorLine + 1] || "";
      self.state.lines[self.state.cursorLine] = currentLine + nextLine;
      self.state.lines.splice(self.state.cursorLine + 1, 1);
    }
  } else {
    self.pushUndoSnapshot();

    // Save lastAction before cursor movement (moveWordForwards resets it)
    const wasKill = self.lastAction === "kill";

    const oldCursorCol = self.state.cursorCol;
    self.moveWordForwards();
    const deleteTo = self.state.cursorCol;
    self.setCursorCol(oldCursorCol);

    const deletedText = currentLine.slice(self.state.cursorCol, deleteTo);
    self.killRing.push(deletedText, { prepend: false, accumulate: wasKill });
    self.lastAction = "kill";

    self.state.lines[self.state.cursorLine] = currentLine.slice(0, self.state.cursorCol) + currentLine.slice(deleteTo);
  }

  if (self.onChange) {
    self.onChange(self.getText());
  }
}

export function do_handleForwardDelete(self: Editor): void {
  self.exitHistoryBrowsing();
  self.lastAction = null;

  const currentLine = self.state.lines[self.state.cursorLine] || "";

  if (self.state.cursorCol < currentLine.length) {
    self.pushUndoSnapshot();

    // Delete grapheme at cursor position (handles emojis, combining characters, etc.)
    const afterCursor = currentLine.slice(self.state.cursorCol);

    // Find the first grapheme at cursor
    const graphemes = [...self.segment(afterCursor, "grapheme")];
    const firstGrapheme = graphemes[0];
    const graphemeLength = firstGrapheme ? firstGrapheme.segment.length : 1;

    const before = currentLine.slice(0, self.state.cursorCol);
    const after = currentLine.slice(self.state.cursorCol + graphemeLength);
    self.state.lines[self.state.cursorLine] = before + after;
  } else if (self.state.cursorLine < self.state.lines.length - 1) {
    self.pushUndoSnapshot();

    // At end of line - merge with next line
    const nextLine = self.state.lines[self.state.cursorLine + 1] || "";
    self.state.lines[self.state.cursorLine] = currentLine + nextLine;
    self.state.lines.splice(self.state.cursorLine + 1, 1);
  }

  if (self.onChange) {
    self.onChange(self.getText());
  }

  // Update or re-trigger autocomplete after forward delete
  if (self.autocompleteState) {
    self.updateAutocomplete();
  } else {
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

export function do_buildVisualLineMap(
  self: Editor,
  width: number,
): Array<{ logicalLine: number; startCol: number; length: number }> {
  const visualLines: Array<{ logicalLine: number; startCol: number; length: number }> = [];

  for (let i = 0; i < self.state.lines.length; i++) {
    const line = self.state.lines[i] || "";
    const lineVisWidth = visibleWidth(line);
    if (line.length === 0) {
      // Empty line still takes one visual line
      visualLines.push({ logicalLine: i, startCol: 0, length: 0 });
    } else if (lineVisWidth <= width) {
      visualLines.push({ logicalLine: i, startCol: 0, length: line.length });
    } else {
      // Line needs wrapping - use word-aware wrapping
      const chunks = wordWrapLine(line, width, [...self.segment(line, "grapheme")]);
      for (const chunk of chunks) {
        visualLines.push({
          logicalLine: i,
          startCol: chunk.startIndex,
          length: chunk.endIndex - chunk.startIndex,
        });
      }
    }
  }

  return visualLines;
}

export function do_findVisualLineAt(
  _self: Editor,
  visualLines: Array<{ logicalLine: number; startCol: number; length: number }>,
  line: number,
  col: number,
): number {
  for (let i = 0; i < visualLines.length; i++) {
    const vl = visualLines[i];
    if (!vl || vl.logicalLine !== line) continue;
    const offset = col - vl.startCol;
    // Cursor is in self segment if it's within range. For the last
    // segment of a logical line, cursor can be at length (end position)
    const isLastSegmentOfLine = i === visualLines.length - 1 || visualLines[i + 1]?.logicalLine !== vl.logicalLine;
    if (offset >= 0 && (offset < vl.length || (isLastSegmentOfLine && offset === vl.length))) {
      return i;
    }
  }
  return visualLines.length - 1;
}

export function do_findCurrentVisualLine(
  self: Editor,
  visualLines: Array<{ logicalLine: number; startCol: number; length: number }>,
): number {
  return self.findVisualLineAt(visualLines, self.state.cursorLine, self.state.cursorCol);
}
