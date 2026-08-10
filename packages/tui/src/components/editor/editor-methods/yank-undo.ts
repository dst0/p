import { findWordForward } from "../../../word-navigation.ts";
import type { Editor } from "../editor.ts";
import { isPasteMarker } from "../paste-marker.ts";

export function do_insertYankedText(self: Editor, text: string): void {
  self.exitHistoryBrowsing();
  const lines = text.split("\n");

  if (lines.length === 1) {
    // Single line - insert at cursor
    const currentLine = self.state.lines[self.state.cursorLine] || "";
    const before = currentLine.slice(0, self.state.cursorCol);
    const after = currentLine.slice(self.state.cursorCol);
    self.state.lines[self.state.cursorLine] = before + text + after;
    self.setCursorCol(self.state.cursorCol + text.length);
  } else {
    // Multi-line insert
    const currentLine = self.state.lines[self.state.cursorLine] || "";
    const before = currentLine.slice(0, self.state.cursorCol);
    const after = currentLine.slice(self.state.cursorCol);

    // First line merges with text before cursor
    self.state.lines[self.state.cursorLine] = before + (lines[0] || "");

    // Insert middle lines
    for (let i = 1; i < lines.length - 1; i++) {
      self.state.lines.splice(self.state.cursorLine + i, 0, lines[i] || "");
    }

    // Last line merges with text after cursor
    const lastLineIndex = self.state.cursorLine + lines.length - 1;
    self.state.lines.splice(lastLineIndex, 0, (lines[lines.length - 1] || "") + after);

    // Update cursor position
    self.state.cursorLine = lastLineIndex;
    self.setCursorCol((lines[lines.length - 1] || "").length);
  }

  if (self.onChange) {
    self.onChange(self.getText());
  }
}

export function do_deleteYankedText(self: Editor): void {
  const yankedText = self.killRing.peek();
  if (!yankedText) return;

  const yankLines = yankedText.split("\n");

  if (yankLines.length === 1) {
    // Single line - delete backward from cursor
    const currentLine = self.state.lines[self.state.cursorLine] || "";
    const deleteLen = yankedText.length;
    const before = currentLine.slice(0, self.state.cursorCol - deleteLen);
    const after = currentLine.slice(self.state.cursorCol);
    self.state.lines[self.state.cursorLine] = before + after;
    self.setCursorCol(self.state.cursorCol - deleteLen);
  } else {
    // Multi-line delete - cursor is at end of last yanked line
    const startLine = self.state.cursorLine - (yankLines.length - 1);
    const startCol = (self.state.lines[startLine] || "").length - (yankLines[0] || "").length;

    // Get text after cursor on current line
    const afterCursor = (self.state.lines[self.state.cursorLine] || "").slice(self.state.cursorCol);

    // Get text before yank start position
    const beforeYank = (self.state.lines[startLine] || "").slice(0, startCol);

    // Remove all lines from startLine to cursorLine and replace with merged line
    self.state.lines.splice(startLine, yankLines.length, beforeYank + afterCursor);

    // Update cursor
    self.state.cursorLine = startLine;
    self.setCursorCol(startCol);
  }

  if (self.onChange) {
    self.onChange(self.getText());
  }
}

export function do_pushUndoSnapshot(self: Editor): void {
  self.undoStack.push(self.state);
}

export function do_undo(self: Editor): void {
  self.exitHistoryBrowsing();
  const snapshot = self.undoStack.pop();
  if (!snapshot) return;
  Object.assign(self.state, snapshot);
  self.lastAction = null;
  self.preferredVisualCol = null;
  if (self.onChange) {
    self.onChange(self.getText());
  }
}

export function do_jumpToChar(self: Editor, char: string, direction: "forward" | "backward"): void {
  self.lastAction = null;
  const isForward = direction === "forward";
  const lines = self.state.lines;

  const end = isForward ? lines.length : -1;
  const step = isForward ? 1 : -1;

  for (let lineIdx = self.state.cursorLine; lineIdx !== end; lineIdx += step) {
    const line = lines[lineIdx] || "";
    const isCurrentLine = lineIdx === self.state.cursorLine;

    // Current line: start after/before cursor; other lines: search full line
    const searchFrom = isCurrentLine ? (isForward ? self.state.cursorCol + 1 : self.state.cursorCol - 1) : undefined;

    const idx = isForward ? line.indexOf(char, searchFrom) : line.lastIndexOf(char, searchFrom);

    if (idx !== -1) {
      self.state.cursorLine = lineIdx;
      self.setCursorCol(idx);
      return;
    }
  }
  // No match found - cursor stays in place
}

export function do_moveWordForwards(self: Editor): void {
  self.lastAction = null;
  const currentLine = self.state.lines[self.state.cursorLine] || "";

  // If at end of line, move to start of next line
  if (self.state.cursorCol >= currentLine.length) {
    if (self.state.cursorLine < self.state.lines.length - 1) {
      self.state.cursorLine++;
      self.setCursorCol(0);
    }
    return;
  }

  self.setCursorCol(
    findWordForward(currentLine, self.state.cursorCol, {
      segment: (text) => self.segment(text, "word"),
      isAtomicSegment: isPasteMarker,
    }),
  );
}

export function do_isSlashMenuAllowed(self: Editor): boolean {
  return self.state.cursorLine === 0;
}

export function do_isAtStartOfMessage(self: Editor): boolean {
  if (!self.isSlashMenuAllowed()) return false;
  const currentLine = self.state.lines[self.state.cursorLine] || "";
  const beforeCursor = currentLine.slice(0, self.state.cursorCol);
  return beforeCursor.trim() === "" || beforeCursor.trim() === "/";
}

export function do_isInSlashCommandContext(self: Editor, textBeforeCursor: string): boolean {
  return self.isSlashMenuAllowed() && textBeforeCursor.trimStart().startsWith("/");
}
