import { isImageLine } from "../../../terminal-image.ts";
import { applyBackgroundToLine, visibleWidth, wrapTextWithAnsi } from "../../../utils.ts";
import { markdownParser } from "../constants.ts";
import type { Markdown } from "../markdown.ts";

export function do_setText(self: Markdown, text: string): void {
  self.text = text;
  self.invalidate();
}

export function do_invalidate(self: Markdown): void {
  self.cachedText = undefined;
  self.cachedWidth = undefined;
  self.cachedLines = undefined;
}

export function do_render(self: Markdown, width: number): string[] {
  // Check cache
  if (self.cachedLines && self.cachedText === self.text && self.cachedWidth === width) {
    return self.cachedLines;
  }

  // Calculate available width for content (subtract horizontal padding)
  const contentWidth = Math.max(1, width - self.paddingX * 2);

  // Don't render anything if there's no actual text
  if (!self.text || self.text.trim() === "") {
    const result: string[] = [];
    // Update cache
    self.cachedText = self.text;
    self.cachedWidth = width;
    self.cachedLines = result;
    return result;
  }

  // Replace tabs with 4 spaces for consistent rendering
  const normalizedText = self.text.replace(/\t/g, "    ");

  // Parse markdown to HTML-like tokens
  const tokens = markdownParser.lexer(normalizedText);

  // Convert tokens to styled terminal output
  const renderedLines: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const nextToken = tokens[i + 1];
    const tokenLines = self.renderToken(token, contentWidth, nextToken?.type);
    for (const tokenLine of tokenLines) {
      renderedLines.push(tokenLine);
    }
  }

  // Wrap lines (NO padding, NO background yet)
  const wrappedLines: string[] = [];
  for (const line of renderedLines) {
    if (isImageLine(line)) {
      wrappedLines.push(line);
    } else {
      for (const wrappedLine of wrapTextWithAnsi(line, contentWidth)) {
        wrappedLines.push(wrappedLine);
      }
    }
  }

  // Add margins and background to each wrapped line
  const leftMargin = " ".repeat(self.paddingX);
  const rightMargin = " ".repeat(self.paddingX);
  const bgFn = self.defaultTextStyle?.bgColor;
  const contentLines: string[] = [];

  for (const line of wrappedLines) {
    if (isImageLine(line)) {
      contentLines.push(line);
      continue;
    }

    const lineWithMargins = leftMargin + line + rightMargin;

    if (bgFn) {
      contentLines.push(applyBackgroundToLine(lineWithMargins, width, bgFn));
    } else {
      // No background - just pad to width
      const visibleLen = visibleWidth(lineWithMargins);
      const paddingNeeded = Math.max(0, width - visibleLen);
      contentLines.push(lineWithMargins + " ".repeat(paddingNeeded));
    }
  }

  // Add top/bottom padding (empty lines)
  const emptyLine = " ".repeat(width);
  const emptyLines: string[] = [];
  for (let i = 0; i < self.paddingY; i++) {
    const line = bgFn ? applyBackgroundToLine(emptyLine, width, bgFn) : emptyLine;
    emptyLines.push(line);
  }

  // Combine top padding, content, and bottom padding
  const result = emptyLines.concat(contentLines, emptyLines);

  // Update cache
  self.cachedText = self.text;
  self.cachedWidth = width;
  self.cachedLines = result;

  return result.length > 0 ? result : [""];
}

export function do_applyDefaultStyle(self: Markdown, text: string): string {
  if (!self.defaultTextStyle) {
    return text;
  }

  let styled = text;

  // Apply foreground color (NOT background - that's applied at padding stage)
  if (self.defaultTextStyle.color) {
    styled = self.defaultTextStyle.color(styled);
  }

  // Apply text decorations using self.theme
  if (self.defaultTextStyle.bold) {
    styled = self.theme.bold(styled);
  }
  if (self.defaultTextStyle.italic) {
    styled = self.theme.italic(styled);
  }
  if (self.defaultTextStyle.strikethrough) {
    styled = self.theme.strikethrough(styled);
  }
  if (self.defaultTextStyle.underline) {
    styled = self.theme.underline(styled);
  }

  return styled;
}
