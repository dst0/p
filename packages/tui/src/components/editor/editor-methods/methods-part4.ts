import { visibleWidth } from "../../../utils.ts";
import type { Editor } from "../editor.ts";
import { wordWrapLine } from "../helpers-part1.ts";
import type { LayoutLine } from "../types.ts";

export function do_layoutText(self: Editor, contentWidth: number): LayoutLine[] {
  const layoutLines: LayoutLine[] = [];

  if (self.state.lines.length === 0 || (self.state.lines.length === 1 && self.state.lines[0] === "")) {
    // Empty editor
    layoutLines.push({
      text: "",
      hasCursor: true,
      cursorPos: 0,
    });
    return layoutLines;
  }

  // Process each logical line
  for (let i = 0; i < self.state.lines.length; i++) {
    const line = self.state.lines[i] || "";
    const isCurrentLine = i === self.state.cursorLine;
    const lineVisibleWidth = visibleWidth(line);

    if (lineVisibleWidth <= contentWidth) {
      // Line fits in one layout line
      if (isCurrentLine) {
        layoutLines.push({
          text: line,
          hasCursor: true,
          cursorPos: self.state.cursorCol,
        });
      } else {
        layoutLines.push({
          text: line,
          hasCursor: false,
        });
      }
    } else {
      // Line needs wrapping - use word-aware wrapping
      const chunks = wordWrapLine(line, contentWidth, [...self.segment(line, "grapheme")]);

      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const chunk = chunks[chunkIndex];
        if (!chunk) continue;

        const cursorPos = self.state.cursorCol;
        const isLastChunk = chunkIndex === chunks.length - 1;

        // Determine if cursor is in self chunk
        // For word-wrapped chunks, we need to handle the case where
        // cursor might be in trimmed whitespace at end of chunk
        let hasCursorInChunk = false;
        let adjustedCursorPos = 0;

        if (isCurrentLine) {
          if (isLastChunk) {
            // Last chunk: cursor belongs here if >= startIndex
            hasCursorInChunk = cursorPos >= chunk.startIndex;
            adjustedCursorPos = cursorPos - chunk.startIndex;
          } else {
            // Non-last chunk: cursor belongs here if in range [startIndex, endIndex)
            // But we need to handle the visual position in the trimmed text
            hasCursorInChunk = cursorPos >= chunk.startIndex && cursorPos < chunk.endIndex;
            if (hasCursorInChunk) {
              adjustedCursorPos = cursorPos - chunk.startIndex;
              // Clamp to text length (in case cursor was in trimmed whitespace)
              if (adjustedCursorPos > chunk.text.length) {
                adjustedCursorPos = chunk.text.length;
              }
            }
          }
        }

        if (hasCursorInChunk) {
          layoutLines.push({
            text: chunk.text,
            hasCursor: true,
            cursorPos: adjustedCursorPos,
          });
        } else {
          layoutLines.push({
            text: chunk.text,
            hasCursor: false,
          });
        }
      }
    }
  }

  return layoutLines;
}

export function do_getText(self: Editor): string {
  return self.state.lines.join("\n");
}

export function do_expandPasteMarkers(self: Editor, text: string): string {
  let result = text;
  for (const [pasteId, pasteContent] of self.pastes) {
    const markerRegex = new RegExp(`\\[paste #${pasteId}( (\\+\\d+ lines|\\d+ chars))?\\]`, "g");
    result = result.replace(markerRegex, () => pasteContent);
  }
  return result;
}

export function do_getExpandedText(self: Editor): string {
  return self.expandPasteMarkers(self.state.lines.join("\n"));
}

export function do_getLines(self: Editor): string[] {
  return [...self.state.lines];
}

export function do_getCursor(self: Editor): { line: number; col: number } {
  return { line: self.state.cursorLine, col: self.state.cursorCol };
}

export function do_setText(self: Editor, text: string): void {
  self.cancelAutocomplete();
  self.lastAction = null;
  self.exitHistoryBrowsing();
  const normalized = self.normalizeText(text);
  // Push undo snapshot if content differs (makes programmatic changes undoable)
  if (self.getText() !== normalized) {
    self.pushUndoSnapshot();
  }
  self.setTextInternal(normalized);
}

export function do_insertTextAtCursor(self: Editor, text: string): void {
  if (!text) return;
  self.cancelAutocomplete();
  self.pushUndoSnapshot();
  self.lastAction = null;
  self.exitHistoryBrowsing();
  self.insertTextAtCursorInternal(text);
}

export function do_normalizeText(_self: Editor, text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\t/g, "    ");
}
