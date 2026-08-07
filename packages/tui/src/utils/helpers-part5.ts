import { AnsiCodeTracker } from "./ansicodetracker.ts";
import { PUNCTUATION_REGEX } from "./constants.ts";
import { visibleWidth } from "./helpers-part2.ts";
import { updateTrackerFromText } from "./helpers-part3.ts";
import { wrapSingleLine } from "./helpers-part4.ts";

export function wrapTextWithAnsi(text: string, width: number): string[] {
  if (!text) {
    return [""];
  }

  // Handle newlines by processing each line separately
  // Track ANSI state across lines so styles carry over after literal newlines
  const inputLines = text.split("\n");
  const result: string[] = [];
  const tracker = new AnsiCodeTracker();

  for (const inputLine of inputLines) {
    // Prepend active ANSI codes from previous lines (except for first line)
    const prefix = result.length > 0 ? tracker.getActiveCodes() : "";
    const wrappedLines = wrapSingleLine(prefix + inputLine, width);
    for (const wrappedLine of wrappedLines) {
      result.push(wrappedLine);
    }
    // Update tracker with codes from this line for next iteration
    updateTrackerFromText(inputLine, tracker);
  }

  return result.length > 0 ? result : [""];
}

export function isWhitespaceChar(char: string): boolean {
  return /\s/.test(char);
}

export function isPunctuationChar(char: string): boolean {
  return PUNCTUATION_REGEX.test(char);
}

export function applyBackgroundToLine(line: string, width: number, bgFn: (text: string) => string): string {
  // Calculate padding needed
  const visibleLen = visibleWidth(line);
  const paddingNeeded = Math.max(0, width - visibleLen);
  const padding = " ".repeat(paddingNeeded);

  // Apply background to content + padding
  const withPadding = line + padding;

  // Extract background ANSI sequence by sampling bgFn with a sentinel
  const sentinel = "\u0000";
  const bgStyled = bgFn(sentinel);
  const sentinelIndex = bgStyled.indexOf(sentinel);
  const bgCode = sentinelIndex >= 0 ? bgStyled.slice(0, sentinelIndex) : "";

  if (!bgCode) {
    return bgFn(withPadding);
  }

  // Re-apply background color whenever a full reset (\x1b[0m or \x1b[m) or background reset (\x1b[49m) occurs in the line
  const reapplied = withPadding.replace(/(\x1b\[0?m|\x1b\[49m)/g, `$1${bgCode}`);
  return bgFn(reapplied);
}
