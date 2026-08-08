import { getKeybindings } from "../../../keybindings.ts";
import { decodeKittyPrintable } from "../../../keys.ts";
import { segmenter } from "../constants.ts";
import type { Input } from "../input.ts";

export function do_handleInput(self: Input, data: string): void {
  // Handle bracketed paste mode
  // Start of paste: \x1b[200~
  // End of paste: \x1b[201~

  // Check if we're starting a bracketed paste
  if (data.includes("\x1b[200~")) {
    self.isInPaste = true;
    self.pasteBuffer = "";
    data = data.replace("\x1b[200~", "");
  }

  // If we're in a paste, buffer the data
  if (self.isInPaste) {
    // Check if self chunk contains the end marker
    self.pasteBuffer += data;

    const endIndex = self.pasteBuffer.indexOf("\x1b[201~");
    if (endIndex !== -1) {
      // Extract the pasted content
      const pasteContent = self.pasteBuffer.substring(0, endIndex);

      // Process the complete paste
      self.handlePaste(pasteContent);

      // Reset paste state
      self.isInPaste = false;

      // Handle any remaining input after the paste marker
      const remaining = self.pasteBuffer.substring(endIndex + 6); // 6 = length of \x1b[201~
      self.pasteBuffer = "";
      if (remaining) {
        self.handleInput(remaining);
      }
    }
    return;
  }

  const kb = getKeybindings();

  // Escape/Cancel
  if (kb.matches(data, "tui.select.cancel")) {
    if (self.onEscape) self.onEscape();
    return;
  }

  // Undo
  if (kb.matches(data, "tui.editor.undo")) {
    self.undo();
    return;
  }

  // Submit
  if (kb.matches(data, "tui.input.submit") || data === "\n") {
    if (self.onSubmit) self.onSubmit(self.value);
    return;
  }

  // Deletion
  if (kb.matches(data, "tui.editor.deleteCharBackward")) {
    self.handleBackspace();
    return;
  }

  if (kb.matches(data, "tui.editor.deleteCharForward")) {
    self.handleForwardDelete();
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

  if (kb.matches(data, "tui.editor.deleteToLineStart")) {
    self.deleteToLineStart();
    return;
  }

  if (kb.matches(data, "tui.editor.deleteToLineEnd")) {
    self.deleteToLineEnd();
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

  // Cursor movement
  if (kb.matches(data, "tui.editor.cursorLeft")) {
    self.lastAction = null;
    if (self.cursor > 0) {
      const beforeCursor = self.value.slice(0, self.cursor);
      const graphemes = [...segmenter.segment(beforeCursor)];
      const lastGrapheme = graphemes[graphemes.length - 1];
      self.cursor -= lastGrapheme ? lastGrapheme.segment.length : 1;
    }
    return;
  }

  if (kb.matches(data, "tui.editor.cursorRight")) {
    self.lastAction = null;
    if (self.cursor < self.value.length) {
      const afterCursor = self.value.slice(self.cursor);
      const graphemes = [...segmenter.segment(afterCursor)];
      const firstGrapheme = graphemes[0];
      self.cursor += firstGrapheme ? firstGrapheme.segment.length : 1;
    }
    return;
  }

  if (kb.matches(data, "tui.editor.cursorLineStart")) {
    self.lastAction = null;
    self.cursor = 0;
    return;
  }

  if (kb.matches(data, "tui.editor.cursorLineEnd")) {
    self.lastAction = null;
    self.cursor = self.value.length;
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

  // Kitty CSI-u printable character (e.g. \x1b[97u for 'a').
  // Terminals with Kitty protocol flag 1 (disambiguate) send CSI-u for all keys,
  // including plain printable characters. Decode before the control-char check
  // since CSI-u sequences contain \x1b which would be rejected.
  const kittyPrintable = decodeKittyPrintable(data);
  if (kittyPrintable !== undefined) {
    self.insertCharacter(kittyPrintable);
    return;
  }

  // Regular character input - accept printable characters including Unicode,
  // but reject control characters (C0: 0x00-0x1F, DEL: 0x7F, C1: 0x80-0x9F)
  const hasControlChars = [...data].some((ch) => {
    const code = ch.charCodeAt(0);
    return code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
  });
  if (!hasControlChars) {
    self.insertCharacter(data);
  }
}
