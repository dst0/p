import { isWhitespaceChar } from "../../../utils.ts";
import type { Editor } from "../editor.ts";

export function do_insertTextAtCursorInternal(self: Editor, text: string): void {
  if (!text) return;

  // Normalize line endings and tabs
  const normalized = self.normalizeText(text);
  const insertedLines = normalized.split("\n");

  const currentLine = self.state.lines[self.state.cursorLine] || "";
  const beforeCursor = currentLine.slice(0, self.state.cursorCol);
  const afterCursor = currentLine.slice(self.state.cursorCol);

  if (insertedLines.length === 1) {
    // Single line - insert at cursor position
    self.state.lines[self.state.cursorLine] = beforeCursor + normalized + afterCursor;
    self.setCursorCol(self.state.cursorCol + normalized.length);
  } else {
    // Multi-line insertion
    self.state.lines = [
      // All lines before current line
      ...self.state.lines.slice(0, self.state.cursorLine),

      // The first inserted line merged with text before cursor
      beforeCursor + insertedLines[0],

      // All middle inserted lines
      ...insertedLines.slice(1, -1),

      // The last inserted line with text after cursor
      insertedLines[insertedLines.length - 1] + afterCursor,

      // All lines after current line
      ...self.state.lines.slice(self.state.cursorLine + 1),
    ];

    self.state.cursorLine += insertedLines.length - 1;
    self.setCursorCol((insertedLines[insertedLines.length - 1] || "").length);
  }

  if (self.onChange) {
    self.onChange(self.getText());
  }
}

export function do_insertCharacter(self: Editor, char: string, skipUndoCoalescing?: boolean): void {
  self.exitHistoryBrowsing();

  // Undo coalescing (fish-style):
  // - Consecutive word chars coalesce into one undo unit
  // - Space captures state before itself (so undo removes space+following word together)
  // - Each space is separately undoable
  // Skip coalescing when called from atomic operations (e.g., handlePaste)
  if (!skipUndoCoalescing) {
    if (isWhitespaceChar(char) || self.lastAction !== "type-word") {
      self.pushUndoSnapshot();
    }
    self.lastAction = "type-word";
  }

  const line = self.state.lines[self.state.cursorLine] || "";

  const before = line.slice(0, self.state.cursorCol);
  const after = line.slice(self.state.cursorCol);

  self.state.lines[self.state.cursorLine] = before + char + after;
  self.setCursorCol(self.state.cursorCol + char.length);

  if (self.onChange) {
    self.onChange(self.getText());
  }

  // Check if we should trigger or update autocomplete
  if (!self.autocompleteState) {
    // Auto-trigger for "/" at the start of a line (slash commands)
    if (char === "/" && self.isAtStartOfMessage()) {
      self.tryTriggerAutocomplete();
    }
    // Auto-trigger for symbol-based completion like @, #, or provider triggers at token boundaries
    else if (self.autocompleteTriggerCharacters.includes(char)) {
      const currentLine = self.state.lines[self.state.cursorLine] || "";
      const textBeforeCursor = currentLine.slice(0, self.state.cursorCol);
      const charBeforeSymbol = textBeforeCursor[textBeforeCursor.length - 2];
      if (textBeforeCursor.length === 1 || charBeforeSymbol === " " || charBeforeSymbol === "\t") {
        self.tryTriggerAutocomplete();
      }
    }
    // Also auto-trigger when typing letters in a slash command or symbol completion context
    else if (/[a-zA-Z0-9.\-_]/.test(char)) {
      const currentLine = self.state.lines[self.state.cursorLine] || "";
      const textBeforeCursor = currentLine.slice(0, self.state.cursorCol);
      // Check if we're in a slash command (with or without space for arguments)
      if (self.isInSlashCommandContext(textBeforeCursor)) {
        self.tryTriggerAutocomplete();
      }
      // Check if we're in a symbol-based completion context like @, #, or provider triggers
      else if (self.autocompleteTriggerPattern.test(textBeforeCursor)) {
        self.tryTriggerAutocomplete();
      }
    }
  } else {
    self.updateAutocomplete();
  }
}
