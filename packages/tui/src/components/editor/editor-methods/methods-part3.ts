import { getKeybindings } from "../../../keybindings.ts";
import { decodePrintableKey, matchesKey } from "../../../keys.ts";
import type { Editor } from "../editor.ts";

export function do_handleInput(self: Editor, data: string): void {
  const kb = getKeybindings();

  // Handle character jump mode (awaiting next character to jump to)
  if (self.jumpMode !== null) {
    // Cancel if the hotkey is pressed again
    if (kb.matches(data, "tui.editor.jumpForward") || kb.matches(data, "tui.editor.jumpBackward")) {
      self.jumpMode = null;
      return;
    }

    const printable = decodePrintableKey(data) ?? (data.charCodeAt(0) >= 32 ? data : undefined);
    if (printable !== undefined) {
      // Printable character - perform the jump
      const direction = self.jumpMode;
      self.jumpMode = null;
      self.jumpToChar(printable, direction);
      return;
    }

    // Control character - cancel and fall through to normal handling
    self.jumpMode = null;
  }

  // Handle bracketed paste mode
  if (data.includes("\x1b[200~")) {
    self.isInPaste = true;
    self.pasteBuffer = "";
    data = data.replace("\x1b[200~", "");
  }

  if (self.isInPaste) {
    self.pasteBuffer += data;
    const endIndex = self.pasteBuffer.indexOf("\x1b[201~");
    if (endIndex !== -1) {
      const pasteContent = self.pasteBuffer.substring(0, endIndex);
      if (pasteContent.length > 0) {
        self.handlePaste(pasteContent);
      }
      self.isInPaste = false;
      const remaining = self.pasteBuffer.substring(endIndex + 6);
      self.pasteBuffer = "";
      if (remaining.length > 0) {
        self.handleInput(remaining);
      }
      return;
    }
    return;
  }

  // Ctrl+C - let parent handle (exit/clear)
  if (kb.matches(data, "tui.input.copy")) {
    return;
  }

  // Undo
  if (kb.matches(data, "tui.editor.undo")) {
    self.undo();
    return;
  }

  // Handle autocomplete mode
  if (self.autocompleteState && self.autocompleteList) {
    if (kb.matches(data, "tui.select.cancel")) {
      self.cancelAutocomplete();
      return;
    }

    if (kb.matches(data, "tui.select.up") || kb.matches(data, "tui.select.down")) {
      self.autocompleteList.handleInput(data);
      return;
    }

    if (kb.matches(data, "tui.input.tab")) {
      const selected = self.autocompleteList.getSelectedItem();
      if (selected && self.autocompleteProvider) {
        self.pushUndoSnapshot();
        self.lastAction = null;
        const result = self.autocompleteProvider.applyCompletion(
          self.state.lines,
          self.state.cursorLine,
          self.state.cursorCol,
          selected,
          self.autocompletePrefix,
        );
        self.state.lines = result.lines;
        self.state.cursorLine = result.cursorLine;
        self.setCursorCol(result.cursorCol);
        self.cancelAutocomplete();
        if (self.onChange) self.onChange(self.getText());
      }
      return;
    }

    if (kb.matches(data, "tui.select.confirm")) {
      const selected = self.autocompleteList.getSelectedItem();
      if (selected && self.autocompleteProvider) {
        self.pushUndoSnapshot();
        self.lastAction = null;
        const result = self.autocompleteProvider.applyCompletion(
          self.state.lines,
          self.state.cursorLine,
          self.state.cursorCol,
          selected,
          self.autocompletePrefix,
        );
        self.state.lines = result.lines;
        self.state.cursorLine = result.cursorLine;
        self.setCursorCol(result.cursorCol);

        if (self.autocompletePrefix.startsWith("/")) {
          self.cancelAutocomplete();
          // Fall through to submit
        } else {
          self.cancelAutocomplete();
          if (self.onChange) self.onChange(self.getText());
          return;
        }
      }
    }
  }

  // Tab - trigger completion
  if (kb.matches(data, "tui.input.tab") && !self.autocompleteState) {
    self.handleTabCompletion();
    return;
  }

  // Deletion actions
  if (kb.matches(data, "tui.editor.deleteToLineEnd")) {
    self.deleteToEndOfLine();
    return;
  }
  if (kb.matches(data, "tui.editor.deleteToLineStart")) {
    self.deleteToStartOfLine();
    return;
  }
  if (kb.matches(data, "tui.editor.deleteWordBackward")) {
    self.deleteWordBackwards();
    return;
  }
  if (kb.matches(data, "tui.editor.deleteWordForward")) {
    self.deleteWordForward();
    return;
  }
  if (kb.matches(data, "tui.editor.deleteCharBackward") || matchesKey(data, "shift+backspace")) {
    self.handleBackspace();
    return;
  }
  if (kb.matches(data, "tui.editor.deleteCharForward") || matchesKey(data, "shift+delete")) {
    self.handleForwardDelete();
    return;
  }

  // Kill ring actions
  if (kb.matches(data, "tui.editor.yank")) {
    self.yank();
    return;
  }
  if (kb.matches(data, "tui.editor.yankPop")) {
    self.yankPop();
    return;
  }

  // Cursor movement actions
  if (kb.matches(data, "tui.editor.cursorLineStart")) {
    self.moveToLineStart();
    return;
  }
  if (kb.matches(data, "tui.editor.cursorLineEnd")) {
    self.moveToLineEnd();
    return;
  }
  if (kb.matches(data, "tui.editor.cursorWordLeft")) {
    self.moveWordBackwards();
    return;
  }
  if (kb.matches(data, "tui.editor.cursorWordRight")) {
    self.moveWordForwards();
    return;
  }

  // New line
  if (
    kb.matches(data, "tui.input.newLine") ||
    (data.charCodeAt(0) === 10 && data.length > 1) ||
    data === "\x1b\r" ||
    data === "\x1b[13;2~" ||
    (data.length > 1 && data.includes("\x1b") && data.includes("\r")) ||
    (data === "\n" && data.length === 1)
  ) {
    if (self.shouldSubmitOnBackslashEnter(data, kb)) {
      self.handleBackspace();
      self.submitValue();
      return;
    }
    self.addNewLine();
    return;
  }

  // Submit (Enter)
  if (kb.matches(data, "tui.input.submit")) {
    if (self.disableSubmit) return;

    // Workaround for terminals without Shift+Enter support:
    // If char before cursor is \, delete it and insert newline instead of submitting.
    const currentLine = self.state.lines[self.state.cursorLine] || "";
    if (self.state.cursorCol > 0 && currentLine[self.state.cursorCol - 1] === "\\") {
      self.handleBackspace();
      self.addNewLine();
      return;
    }

    self.submitValue();
    return;
  }

  // Arrow key navigation (with history support)
  if (kb.matches(data, "tui.editor.cursorUp")) {
    if (self.isOnFirstVisualLine() && self.history.length > 0) {
      self.navigateHistory(-1);
    } else if (self.isOnFirstVisualLine()) {
      // Already at top - jump to start of line
      self.moveToLineStart();
    } else {
      self.moveCursor(-1, 0);
    }
    return;
  }
  if (kb.matches(data, "tui.editor.cursorDown")) {
    if (self.historyIndex > -1 && self.isOnLastVisualLine()) {
      self.navigateHistory(1);
    } else if (self.isOnLastVisualLine()) {
      // Already at bottom - jump to end of line
      self.moveToLineEnd();
    } else {
      self.moveCursor(1, 0);
    }
    return;
  }
  if (kb.matches(data, "tui.editor.cursorRight")) {
    self.moveCursor(0, 1);
    return;
  }
  if (kb.matches(data, "tui.editor.cursorLeft")) {
    self.moveCursor(0, -1);
    return;
  }

  // Page up/down - scroll by page and move cursor
  if (kb.matches(data, "tui.editor.pageUp")) {
    self.pageScroll(-1);
    return;
  }
  if (kb.matches(data, "tui.editor.pageDown")) {
    self.pageScroll(1);
    return;
  }

  // Character jump mode triggers
  if (kb.matches(data, "tui.editor.jumpForward")) {
    self.jumpMode = "forward";
    return;
  }
  if (kb.matches(data, "tui.editor.jumpBackward")) {
    self.jumpMode = "backward";
    return;
  }

  // Shift+Space - insert regular space
  if (matchesKey(data, "shift+space")) {
    self.insertCharacter(" ");
    return;
  }

  const printable = decodePrintableKey(data);
  if (printable !== undefined) {
    self.insertCharacter(printable);
    return;
  }

  // Regular characters
  if (data.charCodeAt(0) >= 32) {
    self.insertCharacter(data);
  }
}
