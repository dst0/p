import type { Token, Tokens } from "marked";
import { wrapTextWithAnsi } from "../../../utils.ts";
import type { Markdown } from "../markdown.ts";
import type { InlineStyleContext } from "../types.ts";

export function do_renderToken(
  self: Markdown,
  token: Token,
  width: number,
  nextTokenType?: string,
  styleContext?: InlineStyleContext,
): string[] {
  const lines: string[] = [];

  switch (token.type) {
    case "heading": {
      const headingLevel = token.depth;
      const headingPrefix = `${"#".repeat(headingLevel)} `;

      // Build a heading-specific style context so inline tokens (codespan, bold, etc.)
      // restore heading styling after their own ANSI resets instead of falling back to
      // the default text style.
      let headingStyleFn: (text: string) => string;
      if (headingLevel === 1) {
        headingStyleFn = (text: string) => self.theme.heading(self.theme.bold(self.theme.underline(text)));
      } else {
        headingStyleFn = (text: string) => self.theme.heading(self.theme.bold(text));
      }

      const headingStyleContext: InlineStyleContext = {
        applyText: headingStyleFn,
        stylePrefix: self.getStylePrefix(headingStyleFn),
      };

      const headingText = self.renderInlineTokens(token.tokens || [], headingStyleContext);
      const styledHeading = headingLevel >= 3 ? headingStyleFn(headingPrefix) + headingText : headingText;
      lines.push(styledHeading);
      if (nextTokenType && nextTokenType !== "space") {
        lines.push(""); // Add spacing after headings (unless space token follows)
      }
      break;
    }

    case "paragraph": {
      const paragraphText = self.renderInlineTokens(token.tokens || [], styleContext);
      lines.push(paragraphText);
      // Don't add spacing if next token is space or list
      if (nextTokenType && nextTokenType !== "list" && nextTokenType !== "space") {
        lines.push("");
      }
      break;
    }

    case "text":
      lines.push(self.renderInlineTokens([token], styleContext));
      break;

    case "code": {
      const indent = self.theme.codeBlockIndent ?? "  ";
      lines.push(self.theme.codeBlockBorder(`\`\`\`${token.lang || ""}`));
      if (self.theme.highlightCode) {
        const highlightedLines = self.theme.highlightCode(token.text, token.lang);
        for (const hlLine of highlightedLines) {
          lines.push(`${indent}${hlLine}`);
        }
      } else {
        // Split code by newlines and style each line
        const codeLines = token.text.split("\n");
        for (const codeLine of codeLines) {
          lines.push(`${indent}${self.theme.codeBlock(codeLine)}`);
        }
      }
      lines.push(self.theme.codeBlockBorder("```"));
      if (nextTokenType && nextTokenType !== "space") {
        lines.push(""); // Add spacing after code blocks (unless space token follows)
      }
      break;
    }

    case "list": {
      const listLines = self.renderList(token as Tokens.List, 0, width, styleContext);
      lines.push(...listLines);
      // Don't add spacing after lists if a space token follows
      // (the space token will handle it)
      break;
    }

    case "table": {
      const tableLines = self.renderTable(token as Tokens.Table, width, nextTokenType, styleContext);
      lines.push(...tableLines);
      break;
    }

    case "blockquote": {
      const quoteStyle = (text: string) => self.theme.quote(self.theme.italic(text));
      const quoteStylePrefix = self.getStylePrefix(quoteStyle);
      const applyQuoteStyle = (line: string): string => {
        if (!quoteStylePrefix) {
          return quoteStyle(line);
        }
        const lineWithReappliedStyle = line.replace(/\x1b\[0m/g, `\x1b[0m${quoteStylePrefix}`);
        return quoteStyle(lineWithReappliedStyle);
      };

      // Calculate available width for quote content (subtract border "│ " = 2 chars)
      const quoteContentWidth = Math.max(1, width - 2);

      // Blockquotes contain block-level tokens (paragraph, list, code, etc.), so render
      // children with renderToken() instead of renderInlineTokens().
      // Default message style should not apply inside blockquotes.
      const quoteInlineStyleContext: InlineStyleContext = {
        applyText: (text: string) => text,
        stylePrefix: quoteStylePrefix,
      };
      const quoteTokens = token.tokens || [];
      const renderedQuoteLines: string[] = [];
      for (let i = 0; i < quoteTokens.length; i++) {
        const quoteToken = quoteTokens[i];
        const nextQuoteToken = quoteTokens[i + 1];
        renderedQuoteLines.push(
          ...self.renderToken(quoteToken, quoteContentWidth, nextQuoteToken?.type, quoteInlineStyleContext),
        );
      }

      // Avoid rendering an extra empty quote line before the outer blockquote spacing.
      while (renderedQuoteLines.length > 0 && renderedQuoteLines[renderedQuoteLines.length - 1] === "") {
        renderedQuoteLines.pop();
      }

      for (const quoteLine of renderedQuoteLines) {
        const styledLine = applyQuoteStyle(quoteLine);
        const wrappedLines = wrapTextWithAnsi(styledLine, quoteContentWidth);
        for (const wrappedLine of wrappedLines) {
          lines.push(self.theme.quoteBorder("│ ") + wrappedLine);
        }
      }
      if (nextTokenType && nextTokenType !== "space") {
        lines.push(""); // Add spacing after blockquotes (unless space token follows)
      }
      break;
    }

    case "hr":
      lines.push(self.theme.hr("─".repeat(Math.min(width, 80))));
      if (nextTokenType && nextTokenType !== "space") {
        lines.push(""); // Add spacing after horizontal rules (unless space token follows)
      }
      break;

    case "html":
      // Render HTML as plain text (escaped for terminal)
      if ("raw" in token && typeof token.raw === "string") {
        lines.push(self.applyDefaultStyle(token.raw.trim()));
      }
      break;

    case "space":
      // Space tokens represent blank lines in markdown
      lines.push("");
      break;

    default:
      // Handle any other token types as plain text
      if ("text" in token && typeof token.text === "string") {
        lines.push(token.text);
      }
  }

  return lines;
}
