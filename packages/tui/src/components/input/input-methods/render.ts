import { CURSOR_MARKER } from "../../../tui.ts";
import { sliceByColumn, visibleWidth } from "../../../utils.ts";
import { segmenter } from "../constants.ts";
import type { Input } from "../input.ts";

export function do_render(self: Input, width: number): string[] {
  // Calculate visible window
  const prompt = "> ";
  const availableWidth = width - prompt.length;

  if (availableWidth <= 0) {
    return [prompt];
  }

  let visibleText = "";
  let cursorDisplay = self.cursor;
  const totalWidth = visibleWidth(self.value);

  if (totalWidth < availableWidth) {
    // Everything fits (leave room for cursor at end)
    visibleText = self.value;
  } else {
    // Need horizontal scrolling - use edge-based scrolling to avoid jitter
    const scrollWidth = self.cursor === self.value.length ? availableWidth - 1 : availableWidth;
    const cursorCol = visibleWidth(self.value.slice(0, self.cursor));
    const scrollMargin = Math.min(5, Math.floor(scrollWidth / 4));

    if (scrollWidth > 0) {
      // Adjust scroll offset only when cursor would go off-screen
      if (cursorCol < self.scrollOffset + scrollMargin) {
        // Cursor too far left — scroll left
        self.scrollOffset = Math.max(0, cursorCol - scrollMargin);
      } else if (cursorCol >= self.scrollOffset + scrollWidth - scrollMargin) {
        // Cursor too far right — scroll right
        self.scrollOffset = Math.max(0, cursorCol - scrollWidth + scrollMargin + 1);
      }
      // Clamp scroll offset to valid range
      self.scrollOffset = Math.min(self.scrollOffset, Math.max(0, totalWidth - scrollWidth));

      visibleText = sliceByColumn(self.value, self.scrollOffset, scrollWidth, true);
      const beforeCursor = sliceByColumn(
        self.value,
        self.scrollOffset,
        Math.max(0, cursorCol - self.scrollOffset),
        true,
      );
      cursorDisplay = beforeCursor.length;
    } else {
      visibleText = "";
      cursorDisplay = 0;
    }
  }

  // Build line with fake cursor
  // Insert cursor character at cursor position
  const graphemes = [...segmenter.segment(visibleText.slice(cursorDisplay))];
  const cursorGrapheme = graphemes[0];

  const beforeCursor = visibleText.slice(0, cursorDisplay);
  const atCursor = cursorGrapheme?.segment ?? " "; // Character at cursor, or space if at end
  const afterCursor = visibleText.slice(cursorDisplay + atCursor.length);

  // Hardware cursor marker (zero-width, emitted before fake cursor for IME positioning)
  const marker = self.focused ? CURSOR_MARKER : "";

  // Use inverse video to show cursor
  const cursorChar = `\x1b[7m${atCursor}\x1b[27m`; // ESC[7m = reverse video, ESC[27m = normal
  const textWithCursor = beforeCursor + marker + cursorChar + afterCursor;

  // Calculate visual width
  const visualLength = visibleWidth(textWithCursor);
  const padding = " ".repeat(Math.max(0, availableWidth - visualLength));
  const line = prompt + textWithCursor + padding;

  return [line];
}
