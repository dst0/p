import { findWordBackward } from "../../../word-navigation.ts";
import type { Editor } from "../editor.ts";
import { isPasteMarker } from "../helpers-part1.ts";

export function do_moveCursor(self: Editor, deltaLine: number, deltaCol: number): void {
  self.lastAction = null;
  const visualLines = self.buildVisualLineMap(self.lastWidth);
  const currentVisualLine = self.findCurrentVisualLine(visualLines);

  if (deltaLine !== 0) {
    const targetVisualLine = currentVisualLine + deltaLine;

    if (targetVisualLine >= 0 && targetVisualLine < visualLines.length) {
      self.moveToVisualLine(visualLines, currentVisualLine, targetVisualLine);
    }
  }

  if (deltaCol !== 0) {
    const currentLine = self.state.lines[self.state.cursorLine] || "";

    if (deltaCol > 0) {
      // Moving right - move by one grapheme (handles emojis, combining characters, etc.)
      if (self.state.cursorCol < currentLine.length) {
        const afterCursor = currentLine.slice(self.state.cursorCol);
        const graphemes = [...self.segment(afterCursor, "grapheme")];
        const firstGrapheme = graphemes[0];
        self.setCursorCol(self.state.cursorCol + (firstGrapheme ? firstGrapheme.segment.length : 1));
      } else if (self.state.cursorLine < self.state.lines.length - 1) {
        // Wrap to start of next logical line
        self.state.cursorLine++;
        self.setCursorCol(0);
      } else {
        // At end of last line - can't move, but set preferredVisualCol for up/down navigation
        const currentVL = visualLines[currentVisualLine];
        if (currentVL) {
          self.preferredVisualCol = self.state.cursorCol - currentVL.startCol;
        }
      }
    } else {
      // Moving left - move by one grapheme (handles emojis, combining characters, etc.)
      if (self.state.cursorCol > 0) {
        const beforeCursor = currentLine.slice(0, self.state.cursorCol);
        const graphemes = [...self.segment(beforeCursor, "grapheme")];
        const lastGrapheme = graphemes[graphemes.length - 1];
        self.setCursorCol(self.state.cursorCol - (lastGrapheme ? lastGrapheme.segment.length : 1));
      } else if (self.state.cursorLine > 0) {
        // Wrap to end of previous logical line
        self.state.cursorLine--;
        const prevLine = self.state.lines[self.state.cursorLine] || "";
        self.setCursorCol(prevLine.length);
      }
    }
  }

  // Keep an open autocomplete picker in sync with the new cursor
  // position: cursor movement changes the text before the cursor, so a
  // picker computed for the old position is stale. Re-query so it
  // refreshes — or closes when the new position yields no suggestions —
  // mirroring insertCharacter()/handleBackspace(). Without self, arrowing
  // left from `/cmd ` back into the command name leaves the argument
  // picker showing against a `/cmd` prefix (and a Tab there would
  // concatenate the stale suggestion onto the partial command name).
  if (self.autocompleteState) {
    self.updateAutocomplete();
  }
}

export function do_pageScroll(self: Editor, direction: -1 | 1): void {
  self.lastAction = null;
  const terminalRows = self.tui.terminal.rows;
  const pageSize = Math.max(5, Math.floor(terminalRows * 0.3));

  const visualLines = self.buildVisualLineMap(self.lastWidth);
  const currentVisualLine = self.findCurrentVisualLine(visualLines);
  const targetVisualLine = Math.max(0, Math.min(visualLines.length - 1, currentVisualLine + direction * pageSize));

  self.moveToVisualLine(visualLines, currentVisualLine, targetVisualLine);
}

export function do_moveWordBackwards(self: Editor): void {
  self.lastAction = null;
  const currentLine = self.state.lines[self.state.cursorLine] || "";

  // If at start of line, move to end of previous line
  if (self.state.cursorCol === 0) {
    if (self.state.cursorLine > 0) {
      self.state.cursorLine--;
      const prevLine = self.state.lines[self.state.cursorLine] || "";
      self.setCursorCol(prevLine.length);
    }
    return;
  }

  self.setCursorCol(
    findWordBackward(currentLine, self.state.cursorCol, {
      segment: (text) => self.segment(text, "word"),
      isAtomicSegment: isPasteMarker,
    }),
  );
}

export function do_yank(self: Editor): void {
  if (self.killRing.length === 0) return;

  self.pushUndoSnapshot();

  const text = self.killRing.peek()!;
  self.insertYankedText(text);

  self.lastAction = "yank";
}

export function do_yankPop(self: Editor): void {
  // Only works if we just yanked and have more than one entry
  if (self.lastAction !== "yank" || self.killRing.length <= 1) return;

  self.pushUndoSnapshot();

  // Delete the previously yanked text (still at end of ring before rotation)
  self.deleteYankedText();

  // Rotate the ring: move end to front
  self.killRing.rotate();

  // Insert the new most recent entry (now at end after rotation)
  const text = self.killRing.peek()!;
  self.insertYankedText(text);

  self.lastAction = "yank";
}
