import { isWhitespaceChar } from "../../../utils.ts";
import { findWordBackward, findWordForward } from "../../../word-navigation.ts";
import { segmenter } from "../constants.ts";
import type { Input } from "../input.ts";

export function do_insertCharacter(self: Input, char: string): void {
  // Undo coalescing: consecutive word chars coalesce into one undo unit
  if (isWhitespaceChar(char) || self.lastAction !== "type-word") {
    self.pushUndo();
  }
  self.lastAction = "type-word";

  self.value = self.value.slice(0, self.cursor) + char + self.value.slice(self.cursor);
  self.cursor += char.length;
}

export function do_handleBackspace(self: Input): void {
  self.lastAction = null;
  if (self.cursor > 0) {
    self.pushUndo();
    const beforeCursor = self.value.slice(0, self.cursor);
    const graphemes = [...segmenter.segment(beforeCursor)];
    const lastGrapheme = graphemes[graphemes.length - 1];
    const graphemeLength = lastGrapheme ? lastGrapheme.segment.length : 1;
    self.value = self.value.slice(0, self.cursor - graphemeLength) + self.value.slice(self.cursor);
    self.cursor -= graphemeLength;
  }
}

export function do_handleForwardDelete(self: Input): void {
  self.lastAction = null;
  if (self.cursor < self.value.length) {
    self.pushUndo();
    const afterCursor = self.value.slice(self.cursor);
    const graphemes = [...segmenter.segment(afterCursor)];
    const firstGrapheme = graphemes[0];
    const graphemeLength = firstGrapheme ? firstGrapheme.segment.length : 1;
    self.value = self.value.slice(0, self.cursor) + self.value.slice(self.cursor + graphemeLength);
  }
}

export function do_deleteToLineStart(self: Input): void {
  if (self.cursor === 0) return;
  self.pushUndo();
  const deletedText = self.value.slice(0, self.cursor);
  self.killRing.push(deletedText, { prepend: true, accumulate: self.lastAction === "kill" });
  self.lastAction = "kill";
  self.value = self.value.slice(self.cursor);
  self.cursor = 0;
}

export function do_deleteToLineEnd(self: Input): void {
  if (self.cursor >= self.value.length) return;
  self.pushUndo();
  const deletedText = self.value.slice(self.cursor);
  self.killRing.push(deletedText, { prepend: false, accumulate: self.lastAction === "kill" });
  self.lastAction = "kill";
  self.value = self.value.slice(0, self.cursor);
}

export function do_deleteWordBackwards(self: Input): void {
  if (self.cursor === 0) return;

  // Save lastAction before cursor movement (moveWordBackwards resets it)
  const wasKill = self.lastAction === "kill";

  self.pushUndo();

  const oldCursor = self.cursor;
  self.moveWordBackwards();
  const deleteFrom = self.cursor;
  self.cursor = oldCursor;

  const deletedText = self.value.slice(deleteFrom, self.cursor);
  self.killRing.push(deletedText, { prepend: true, accumulate: wasKill });
  self.lastAction = "kill";

  self.value = self.value.slice(0, deleteFrom) + self.value.slice(self.cursor);
  self.cursor = deleteFrom;
}

export function do_deleteWordForward(self: Input): void {
  if (self.cursor >= self.value.length) return;

  // Save lastAction before cursor movement (moveWordForwards resets it)
  const wasKill = self.lastAction === "kill";

  self.pushUndo();

  const oldCursor = self.cursor;
  self.moveWordForwards();
  const deleteTo = self.cursor;
  self.cursor = oldCursor;

  const deletedText = self.value.slice(self.cursor, deleteTo);
  self.killRing.push(deletedText, { prepend: false, accumulate: wasKill });
  self.lastAction = "kill";

  self.value = self.value.slice(0, self.cursor) + self.value.slice(deleteTo);
}

export function do_yank(self: Input): void {
  const text = self.killRing.peek();
  if (!text) return;

  self.pushUndo();

  self.value = self.value.slice(0, self.cursor) + text + self.value.slice(self.cursor);
  self.cursor += text.length;
  self.lastAction = "yank";
}

export function do_yankPop(self: Input): void {
  if (self.lastAction !== "yank" || self.killRing.length <= 1) return;

  self.pushUndo();

  // Delete the previously yanked text (still at end of ring before rotation)
  const prevText = self.killRing.peek() || "";
  self.value = self.value.slice(0, self.cursor - prevText.length) + self.value.slice(self.cursor);
  self.cursor -= prevText.length;

  // Rotate and insert new entry
  self.killRing.rotate();
  const text = self.killRing.peek() || "";
  self.value = self.value.slice(0, self.cursor) + text + self.value.slice(self.cursor);
  self.cursor += text.length;
  self.lastAction = "yank";
}

export function do_pushUndo(self: Input): void {
  self.undoStack.push({ value: self.value, cursor: self.cursor });
}

export function do_undo(self: Input): void {
  const snapshot = self.undoStack.pop();
  if (!snapshot) return;
  self.value = snapshot.value;
  self.cursor = snapshot.cursor;
  self.lastAction = null;
}

export function do_moveWordBackwards(self: Input): void {
  if (self.cursor === 0) return;
  self.lastAction = null;
  self.cursor = findWordBackward(self.value, self.cursor);
}

export function do_moveWordForwards(self: Input): void {
  if (self.cursor >= self.value.length) return;
  self.lastAction = null;
  self.cursor = findWordForward(self.value, self.cursor);
}

export function do_handlePaste(self: Input, pastedText: string): void {
  self.lastAction = null;
  self.pushUndo();

  // Clean the pasted text - remove newlines and carriage returns
  const cleanText = pastedText.replace(/\r\n/g, "").replace(/\r/g, "").replace(/\n/g, "").replace(/\t/g, "    ");

  // Insert at cursor position
  self.value = self.value.slice(0, self.cursor) + cleanText + self.value.slice(self.cursor);
  self.cursor += cleanText.length;
}

export function do_invalidate(_self: Input): void {
  // No cached state to invalidate currently
}
