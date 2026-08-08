import type { getKeybindings } from "../../../keybindings.ts";
import { matchesKey } from "../../../keys.ts";
import type { Editor } from "../editor.ts";

export function do_handlePaste(self: Editor, pastedText: string): void {
  self.cancelAutocomplete();
  self.exitHistoryBrowsing();
  self.lastAction = null;

  self.pushUndoSnapshot();

  // Some terminals (e.g. tmux popups with extended-keys-format=csi-u) re-encode
  // control bytes inside bracketed paste as CSI-u Ctrl+<letter> sequences
  // (ESC [ <codepoint> ; 5 u). Decode those back to their literal byte so the
  // per-char filter below preserves newlines instead of stripping ESC and
  // leaking the printable tail (e.g. "[106;5u") into the editor.
  const decodedText = pastedText.replace(/\x1b\[(\d+);5u/g, (match, code) => {
    const cp = Number(code);
    if (cp >= 97 && cp <= 122) return String.fromCharCode(cp - 96);
    if (cp >= 65 && cp <= 90) return String.fromCharCode(cp - 64);
    return match;
  });

  // Clean the pasted text: normalize line endings, expand tabs
  const cleanText = self.normalizeText(decodedText);

  // Filter out non-printable characters except newlines
  let filteredText = cleanText
    .split("")
    .filter((char) => char === "\n" || char.charCodeAt(0) >= 32)
    .join("");

  // If pasting a file path (starts with /, ~, or .) and the character before
  // the cursor is a word character, prepend a space for better readability
  if (/^[/~.]/.test(filteredText)) {
    const currentLine = self.state.lines[self.state.cursorLine] || "";
    const charBeforeCursor = self.state.cursorCol > 0 ? currentLine[self.state.cursorCol - 1] : "";
    if (charBeforeCursor && /\w/.test(charBeforeCursor)) {
      filteredText = ` ${filteredText}`;
    }
  }

  // Split into lines to check for large paste
  const pastedLines = filteredText.split("\n");

  // Check if self is a large paste (> 10 lines or > 1000 characters)
  const totalChars = filteredText.length;
  if (pastedLines.length > 10 || totalChars > 1000) {
    // Store the paste and insert a marker
    self.pasteCounter++;
    const pasteId = self.pasteCounter;
    self.pastes.set(pasteId, filteredText);

    // Insert marker like "[paste #1 +123 lines]" or "[paste #1 1234 chars]"
    const marker =
      pastedLines.length > 10
        ? `[paste #${pasteId} +${pastedLines.length} lines]`
        : `[paste #${pasteId} ${totalChars} chars]`;
    self.insertTextAtCursorInternal(marker);
    return;
  }

  if (pastedLines.length === 1) {
    // Single line - insert atomically (do not trigger autocomplete during paste)
    self.insertTextAtCursorInternal(filteredText);
    return;
  }

  // Multi-line paste - use direct state manipulation
  self.insertTextAtCursorInternal(filteredText);
}

export function do_addNewLine(self: Editor): void {
  self.cancelAutocomplete();
  self.exitHistoryBrowsing();
  self.lastAction = null;

  self.pushUndoSnapshot();

  const currentLine = self.state.lines[self.state.cursorLine] || "";

  const before = currentLine.slice(0, self.state.cursorCol);
  const after = currentLine.slice(self.state.cursorCol);

  // Split current line
  self.state.lines[self.state.cursorLine] = before;
  self.state.lines.splice(self.state.cursorLine + 1, 0, after);

  // Move cursor to start of new line
  self.state.cursorLine++;
  self.setCursorCol(0);

  if (self.onChange) {
    self.onChange(self.getText());
  }
}

export function do_shouldSubmitOnBackslashEnter(
  self: Editor,
  data: string,
  kb: ReturnType<typeof getKeybindings>,
): boolean {
  if (self.disableSubmit) return false;
  if (!matchesKey(data, "enter")) return false;
  const submitKeys = kb.getKeys("tui.input.submit");
  const hasShiftEnter = submitKeys.includes("shift+enter") || submitKeys.includes("shift+return");
  if (!hasShiftEnter) return false;

  const currentLine = self.state.lines[self.state.cursorLine] || "";
  return self.state.cursorCol > 0 && currentLine[self.state.cursorCol - 1] === "\\";
}

export function do_submitValue(self: Editor): void {
  self.cancelAutocomplete();
  const result = self.expandPasteMarkers(self.state.lines.join("\n")).trim();

  self.state = { lines: [""], cursorLine: 0, cursorCol: 0 };
  self.pastes.clear();
  self.pasteCounter = 0;
  self.exitHistoryBrowsing();
  self.scrollOffset = 0;
  self.undoStack.clear();
  self.lastAction = null;

  if (self.onChange) self.onChange("");
  if (self.onSubmit) self.onSubmit(result);
}
