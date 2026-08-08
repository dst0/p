import type { Editor } from "../editor.ts";

export function do_computeVerticalMoveColumn(
  self: Editor,
  currentVisualCol: number,
  sourceMaxVisualCol: number,
  targetMaxVisualCol: number,
): number {
  const hasPreferred = self.preferredVisualCol !== null; // P
  const cursorInMiddle = currentVisualCol < sourceMaxVisualCol; // S
  const targetTooShort = targetMaxVisualCol < currentVisualCol; // T

  if (!hasPreferred || cursorInMiddle) {
    if (targetTooShort) {
      // Cases 2 and 7
      self.preferredVisualCol = currentVisualCol;
      return targetMaxVisualCol;
    }

    // Cases 1 and 6
    self.preferredVisualCol = null;
    return currentVisualCol;
  }

  const targetCantFitPreferred = targetMaxVisualCol < self.preferredVisualCol!; // U
  if (targetTooShort || targetCantFitPreferred) {
    // Cases 4 and 5
    return targetMaxVisualCol;
  }

  // Case 3
  const result = self.preferredVisualCol!;
  self.preferredVisualCol = null;
  return result;
}

export function do_moveToLineStart(self: Editor): void {
  self.lastAction = null;
  self.setCursorCol(0);
}

export function do_moveToLineEnd(self: Editor): void {
  self.lastAction = null;
  const currentLine = self.state.lines[self.state.cursorLine] || "";
  self.setCursorCol(currentLine.length);
}

export function do_deleteToStartOfLine(self: Editor): void {
  self.exitHistoryBrowsing();

  const currentLine = self.state.lines[self.state.cursorLine] || "";

  if (self.state.cursorCol > 0) {
    self.pushUndoSnapshot();

    // Calculate text to be deleted and save to kill ring (backward deletion = prepend)
    const deletedText = currentLine.slice(0, self.state.cursorCol);
    self.killRing.push(deletedText, { prepend: true, accumulate: self.lastAction === "kill" });
    self.lastAction = "kill";

    // Delete from start of line up to cursor
    self.state.lines[self.state.cursorLine] = currentLine.slice(self.state.cursorCol);
    self.setCursorCol(0);
  } else if (self.state.cursorLine > 0) {
    self.pushUndoSnapshot();

    // At start of line - merge with previous line, treating newline as deleted text
    self.killRing.push("\n", { prepend: true, accumulate: self.lastAction === "kill" });
    self.lastAction = "kill";

    const previousLine = self.state.lines[self.state.cursorLine - 1] || "";
    self.state.lines[self.state.cursorLine - 1] = previousLine + currentLine;
    self.state.lines.splice(self.state.cursorLine, 1);
    self.state.cursorLine--;
    self.setCursorCol(previousLine.length);
  }

  if (self.onChange) {
    self.onChange(self.getText());
  }
}

export function do_deleteToEndOfLine(self: Editor): void {
  self.exitHistoryBrowsing();

  const currentLine = self.state.lines[self.state.cursorLine] || "";

  if (self.state.cursorCol < currentLine.length) {
    self.pushUndoSnapshot();

    // Calculate text to be deleted and save to kill ring (forward deletion = append)
    const deletedText = currentLine.slice(self.state.cursorCol);
    self.killRing.push(deletedText, { prepend: false, accumulate: self.lastAction === "kill" });
    self.lastAction = "kill";

    // Delete from cursor to end of line
    self.state.lines[self.state.cursorLine] = currentLine.slice(0, self.state.cursorCol);
  } else if (self.state.cursorLine < self.state.lines.length - 1) {
    self.pushUndoSnapshot();

    // At end of line - merge with next line, treating newline as deleted text
    self.killRing.push("\n", { prepend: false, accumulate: self.lastAction === "kill" });
    self.lastAction = "kill";

    const nextLine = self.state.lines[self.state.cursorLine + 1] || "";
    self.state.lines[self.state.cursorLine] = currentLine + nextLine;
    self.state.lines.splice(self.state.cursorLine + 1, 1);
  }

  if (self.onChange) {
    self.onChange(self.getText());
  }
}

export function do_deleteWordBackwards(self: Editor): void {
  self.exitHistoryBrowsing();

  const currentLine = self.state.lines[self.state.cursorLine] || "";

  // If at start of line, behave like backspace at column 0 (merge with previous line)
  if (self.state.cursorCol === 0) {
    if (self.state.cursorLine > 0) {
      self.pushUndoSnapshot();

      // Treat newline as deleted text (backward deletion = prepend)
      self.killRing.push("\n", { prepend: true, accumulate: self.lastAction === "kill" });
      self.lastAction = "kill";

      const previousLine = self.state.lines[self.state.cursorLine - 1] || "";
      self.state.lines[self.state.cursorLine - 1] = previousLine + currentLine;
      self.state.lines.splice(self.state.cursorLine, 1);
      self.state.cursorLine--;
      self.setCursorCol(previousLine.length);
    }
  } else {
    self.pushUndoSnapshot();

    // Save lastAction before cursor movement (moveWordBackwards resets it)
    const wasKill = self.lastAction === "kill";

    const oldCursorCol = self.state.cursorCol;
    self.moveWordBackwards();
    const deleteFrom = self.state.cursorCol;
    self.setCursorCol(oldCursorCol);

    const deletedText = currentLine.slice(deleteFrom, self.state.cursorCol);
    self.killRing.push(deletedText, { prepend: true, accumulate: wasKill });
    self.lastAction = "kill";

    self.state.lines[self.state.cursorLine] =
      currentLine.slice(0, deleteFrom) + currentLine.slice(self.state.cursorCol);
    self.setCursorCol(deleteFrom);
  }

  if (self.onChange) {
    self.onChange(self.getText());
  }
}
