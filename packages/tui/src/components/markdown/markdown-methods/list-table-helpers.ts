import type { Tokens } from "marked";
import { visibleWidth, wrapTextWithAnsi } from "../../../utils.ts";
import type { Markdown } from "../markdown.ts";
import type { InlineStyleContext } from "../types.ts";

export function do_renderList(
  self: Markdown,
  token: Tokens.List,
  depth: number,
  width: number,
  styleContext?: InlineStyleContext,
): string[] {
  const lines: string[] = [];
  const indent = "    ".repeat(depth);
  // Use the list's start property (defaults to 1 for ordered lists)
  const startNumber = typeof token.start === "number" ? token.start : 1;

  for (let i = 0; i < token.items.length; i++) {
    const item = token.items[i];
    const isLastItem = i === token.items.length - 1;
    const bullet = token.ordered
      ? self.options.preserveOrderedListMarkers
        ? (self.getOrderedListMarker(item) ?? `${startNumber + i}. `)
        : `${startNumber + i}. `
      : self.options.preserveOrderedListMarkers
        ? (self.getUnorderedListMarker(item) ?? "- ")
        : "- ";
    const taskMarker = item.task ? `[${item.checked ? "x" : " "}] ` : "";
    const marker = bullet + taskMarker;
    const firstPrefix = indent + self.theme.listBullet(marker);
    const continuationPrefix = indent + " ".repeat(visibleWidth(marker));
    const itemWidth = Math.max(1, width - visibleWidth(firstPrefix));
    let renderedAnyLine = false;

    for (const itemToken of item.tokens) {
      if (itemToken.type === "list") {
        lines.push(...self.renderList(itemToken as Tokens.List, depth + 1, width, styleContext));
        renderedAnyLine = true;
        continue;
      }

      const itemLines = self.renderToken(itemToken, itemWidth, undefined, styleContext);
      for (const line of itemLines) {
        for (const wrappedLine of wrapTextWithAnsi(line, itemWidth)) {
          const linePrefix = renderedAnyLine ? continuationPrefix : firstPrefix;
          lines.push(linePrefix + wrappedLine);
          renderedAnyLine = true;
        }
      }
    }

    if (!renderedAnyLine) {
      lines.push(firstPrefix);
    }

    if (token.loose && !isLastItem) {
      lines.push("");
    }
  }

  return lines;
}

export function do_getLongestWordWidth(_self: Markdown, text: string, maxWidth?: number): number {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  let longest = 0;
  for (const word of words) {
    longest = Math.max(longest, visibleWidth(word));
  }
  if (maxWidth === undefined) {
    return longest;
  }
  return Math.min(longest, maxWidth);
}

export function do_wrapCellText(_self: Markdown, text: string, maxWidth: number): string[] {
  return wrapTextWithAnsi(text, Math.max(1, maxWidth));
}
