import type { Token, Tokens } from "marked";
import { getCapabilities, hyperlink } from "../../../terminal-image.ts";
import type { Markdown } from "../markdown.ts";
import type { InlineStyleContext } from "../types.ts";

export function do_renderInlineTokens(self: Markdown, tokens: Token[], styleContext?: InlineStyleContext): string {
  let result = "";
  const resolvedStyleContext = styleContext ?? self.getDefaultInlineStyleContext();
  const { applyText, stylePrefix } = resolvedStyleContext;
  const applyTextWithNewlines = (text: string): string => {
    const segments: string[] = text.split("\n");
    return segments.map((segment: string) => applyText(segment)).join("\n");
  };

  for (const token of tokens) {
    switch (token.type) {
      case "text":
        // Text tokens in list items can have nested tokens for inline formatting
        if (token.tokens && token.tokens.length > 0) {
          result += self.renderInlineTokens(token.tokens, resolvedStyleContext);
        } else {
          result += applyTextWithNewlines(token.text);
        }
        break;

      case "paragraph":
        // Paragraph tokens contain nested inline tokens
        result += self.renderInlineTokens(token.tokens || [], resolvedStyleContext);
        break;

      case "strong": {
        const boldContent = self.renderInlineTokens(token.tokens || [], resolvedStyleContext);
        result += self.theme.bold(boldContent) + stylePrefix;
        break;
      }

      case "em": {
        const italicContent = self.renderInlineTokens(token.tokens || [], resolvedStyleContext);
        result += self.theme.italic(italicContent) + stylePrefix;
        break;
      }

      case "codespan":
        result += self.theme.code(token.text) + stylePrefix;
        break;

      case "link": {
        const linkText = self.renderInlineTokens(token.tokens || [], resolvedStyleContext);
        const styledLink = self.theme.link(self.theme.underline(linkText));
        if (getCapabilities().hyperlinks) {
          // OSC 8: render as a clickable hyperlink. The URL is not printed inline,
          // so we always show only the link text regardless of whether it matches href.
          result += hyperlink(styledLink, token.href) + stylePrefix;
        } else {
          // Fallback: print URL in parentheses when text differs from href.
          // Compare raw token.text (not styled) against href for the equality check.
          // For mailto: links strip the prefix (autolinked emails use text="foo@bar.com"
          // but href="mailto:foo@bar.com").
          const hrefForComparison = token.href.startsWith("mailto:") ? token.href.slice(7) : token.href;
          if (token.text === token.href || token.text === hrefForComparison) {
            result += styledLink + stylePrefix;
          } else {
            result += styledLink + self.theme.linkUrl(` (${token.href})`) + stylePrefix;
          }
        }
        break;
      }

      case "br":
        result += "\n";
        break;

      case "del": {
        const delContent = self.renderInlineTokens(token.tokens || [], resolvedStyleContext);
        result += self.theme.strikethrough(delContent) + stylePrefix;
        break;
      }

      case "html":
        // Render inline HTML as plain text
        if ("raw" in token && typeof token.raw === "string") {
          result += applyTextWithNewlines(token.raw);
        }
        break;

      default:
        // Handle any other inline token types as plain text
        if ("text" in token && typeof token.text === "string") {
          result += applyTextWithNewlines(token.text);
        }
    }
  }

  while (stylePrefix && result.endsWith(stylePrefix)) {
    result = result.slice(0, -stylePrefix.length);
  }

  return result;
}

export function do_getOrderedListMarker(_self: Markdown, item: Tokens.ListItem): string | undefined {
  const match = /^(?: {0,3})(\d{1,9}[.)])[ \t]+/.exec(item.raw);
  return match ? `${match[1]} ` : undefined;
}

export function do_getUnorderedListMarker(_self: Markdown, item: Tokens.ListItem): string | undefined {
  const match = /^(?: {0,3})([-+*])(?:[ \t]+|(?=\r?\n|$))/.exec(item.raw);
  return match ? `${match[1]} ` : undefined;
}
