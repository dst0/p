import { CURSOR_MARKER } from "../../../tui.ts";
import { truncateToWidth, visibleWidth } from "../../../utils.ts";
import type { Editor } from "../editor.ts";

export function do_render(self: Editor, width: number): string[] {
  const maxPadding = Math.max(0, Math.floor((width - 1) / 2));
  const paddingX = Math.min(self.paddingX, maxPadding);
  const contentWidth = Math.max(1, width - paddingX * 2);

  // Layout width: with padding the cursor can overflow into it,
  // without padding we reserve 1 column for the cursor.
  const layoutWidth = Math.max(1, contentWidth - (paddingX ? 0 : 1));

  // Store for cursor navigation (must match wrapping width)
  self.lastWidth = layoutWidth;

  const horizontal = self.borderColor("─");

  // Layout the text
  const layoutLines = self.layoutText(layoutWidth);

  // Calculate max visible lines: 30% of terminal height, minimum 5 lines
  const terminalRows = self.tui.terminal.rows;
  const maxVisibleLines = Math.max(5, Math.floor(terminalRows * 0.3));

  // Find the cursor line index in layoutLines
  let cursorLineIndex = layoutLines.findIndex((line) => line.hasCursor);
  if (cursorLineIndex === -1) cursorLineIndex = 0;

  // Adjust scroll offset to keep cursor visible
  if (cursorLineIndex < self.scrollOffset) {
    self.scrollOffset = cursorLineIndex;
  } else if (cursorLineIndex >= self.scrollOffset + maxVisibleLines) {
    self.scrollOffset = cursorLineIndex - maxVisibleLines + 1;
  }

  // Clamp scroll offset to valid range
  const maxScrollOffset = Math.max(0, layoutLines.length - maxVisibleLines);
  self.scrollOffset = Math.max(0, Math.min(self.scrollOffset, maxScrollOffset));

  // Get visible lines slice
  const visibleLines = layoutLines.slice(self.scrollOffset, self.scrollOffset + maxVisibleLines);

  const result: string[] = [];
  const leftPadding = " ".repeat(paddingX);
  const rightPadding = leftPadding;

  // Render top border (with scroll indicator if scrolled down)
  if (self.scrollOffset > 0) {
    const indicator = `─── ↑ ${self.scrollOffset} more `;
    const remaining = width - visibleWidth(indicator);
    if (remaining >= 0) {
      result.push(self.borderColor(indicator + "─".repeat(remaining)));
    } else {
      result.push(self.borderColor(truncateToWidth(indicator, width)));
    }
  } else {
    result.push(horizontal.repeat(width));
  }

  // Render each visible layout line
  // Emit hardware cursor marker when focused so TUI can position the
  // hardware cursor for IME candidate-window placement even while
  // autocomplete (e.g. slash-command menu) is visible.
  const emitCursorMarker = self.focused;

  for (const layoutLine of visibleLines) {
    let displayText = layoutLine.text;
    let lineVisibleWidth = visibleWidth(layoutLine.text);
    let cursorInPadding = false;

    // Add cursor if self line has it
    if (layoutLine.hasCursor && layoutLine.cursorPos !== undefined) {
      const before = displayText.slice(0, layoutLine.cursorPos);
      const after = displayText.slice(layoutLine.cursorPos);

      // Hardware cursor marker (zero-width, emitted before fake cursor for IME positioning)
      const marker = emitCursorMarker ? CURSOR_MARKER : "";

      if (after.length > 0) {
        // Cursor is on a character (grapheme) - replace it with highlighted version
        // Get the first grapheme from 'after'
        const afterGraphemes = [...self.segment(after, "grapheme")];
        const firstGrapheme = afterGraphemes[0]?.segment || "";
        const restAfter = after.slice(firstGrapheme.length);
        const cursor = `\x1b[7m${firstGrapheme}\x1b[0m`;
        displayText = before + marker + cursor + restAfter;
        // lineVisibleWidth stays the same - we're replacing, not adding
      } else {
        // Cursor is at the end - add highlighted space
        const cursor = "\x1b[7m \x1b[0m";
        displayText = before + marker + cursor;
        lineVisibleWidth = lineVisibleWidth + 1;
        // If cursor overflows content width into the padding, flag it
        if (lineVisibleWidth > contentWidth && paddingX > 0) {
          cursorInPadding = true;
        }
      }
    }

    // Calculate padding based on actual visible width
    const padding = " ".repeat(Math.max(0, contentWidth - lineVisibleWidth));
    const lineRightPadding = cursorInPadding ? rightPadding.slice(1) : rightPadding;

    // Render the line (no side borders, just horizontal lines above and below)
    result.push(`${leftPadding}${displayText}${padding}${lineRightPadding}`);
  }

  // Render bottom border (with scroll indicator if more content below)
  const linesBelow = layoutLines.length - (self.scrollOffset + visibleLines.length);
  if (linesBelow > 0) {
    const indicator = `─── ↓ ${linesBelow} more `;
    const remaining = width - visibleWidth(indicator);
    result.push(self.borderColor(indicator + "─".repeat(Math.max(0, remaining))));
  } else {
    result.push(horizontal.repeat(width));
  }

  // Add autocomplete list if active
  if (self.autocompleteState && self.autocompleteList) {
    const autocompleteResult = self.autocompleteList.render(contentWidth);
    for (const line of autocompleteResult) {
      const lineWidth = visibleWidth(line);
      const linePadding = " ".repeat(Math.max(0, contentWidth - lineWidth));
      result.push(`${leftPadding}${line}${linePadding}${rightPadding}`);
    }
  }

  return result;
}
