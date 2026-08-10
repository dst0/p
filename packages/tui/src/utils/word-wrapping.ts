import { AnsiCodeTracker } from "./ansicodetracker.ts";
import { graphemeSegmenter } from "./constants.ts";
import { extractAnsiCode } from "./segmentation.ts";
import { splitIntoTokensWithAnsi, updateTrackerFromText } from "./terminal-output.ts";
import { visibleWidth } from "./width-truncation.ts";

export function breakLongWord(word: string, width: number, tracker: AnsiCodeTracker): string[] {
  const lines: string[] = [];
  let currentLine = tracker.getActiveCodes();
  let currentWidth = 0;

  // First, separate ANSI codes from visible content
  // We need to handle ANSI codes specially since they're not graphemes
  let i = 0;
  const segments: Array<{ type: "ansi" | "grapheme"; value: string }> = [];

  while (i < word.length) {
    const ansiResult = extractAnsiCode(word, i);
    if (ansiResult) {
      segments.push({ type: "ansi", value: ansiResult.code });
      i += ansiResult.length;
    } else {
      // Find the next ANSI code or end of string
      let end = i;
      while (end < word.length) {
        const nextAnsi = extractAnsiCode(word, end);
        if (nextAnsi) break;
        end++;
      }
      // Segment this non-ANSI portion into graphemes
      const textPortion = word.slice(i, end);
      for (const seg of graphemeSegmenter.segment(textPortion)) {
        segments.push({ type: "grapheme", value: seg.segment });
      }
      i = end;
    }
  }

  // Now process segments
  for (const seg of segments) {
    if (seg.type === "ansi") {
      currentLine += seg.value;
      tracker.process(seg.value);
      continue;
    }

    const grapheme = seg.value;
    // Skip empty graphemes to avoid issues with string-width calculation
    if (!grapheme) continue;

    const graphemeWidth = visibleWidth(grapheme);

    if (currentWidth + graphemeWidth > width) {
      // Add specific reset for underline only (preserves background)
      const lineEndReset = tracker.getLineEndReset();
      if (lineEndReset) {
        currentLine += lineEndReset;
      }
      lines.push(currentLine);
      currentLine = tracker.getActiveCodes();
      currentWidth = 0;
    }

    currentLine += grapheme;
    currentWidth += graphemeWidth;
  }

  if (currentLine) {
    // No reset at end of final segment - caller handles continuation
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [""];
}

export function wrapSingleLine(line: string, width: number): string[] {
  if (!line) {
    return [""];
  }

  const visibleLength = visibleWidth(line);
  if (visibleLength <= width) {
    return [line];
  }

  const wrapped: string[] = [];
  const tracker = new AnsiCodeTracker();
  const tokens = splitIntoTokensWithAnsi(line);

  let currentLine = "";
  let currentVisibleLength = 0;

  for (const token of tokens) {
    const tokenVisibleLength = visibleWidth(token);
    const isWhitespace = token.trim() === "";

    // Token itself is too long - break it character by character
    if (tokenVisibleLength > width && !isWhitespace) {
      if (currentLine) {
        // Add specific reset for underline only (preserves background)
        const lineEndReset = tracker.getLineEndReset();
        if (lineEndReset) {
          currentLine += lineEndReset;
        }
        wrapped.push(currentLine);
        currentLine = "";
        currentVisibleLength = 0;
      }

      // Break long token - breakLongWord handles its own resets
      const broken = breakLongWord(token, width, tracker);
      for (let i = 0; i < broken.length - 1; i++) {
        wrapped.push(broken[i]!);
      }
      currentLine = broken[broken.length - 1];
      currentVisibleLength = visibleWidth(currentLine);
      continue;
    }

    // Check if adding this token would exceed width
    const totalNeeded = currentVisibleLength + tokenVisibleLength;

    if (totalNeeded > width && currentVisibleLength > 0) {
      // Trim trailing whitespace, then add underline reset (not full reset, to preserve background)
      let lineToWrap = currentLine.trimEnd();
      const lineEndReset = tracker.getLineEndReset();
      if (lineEndReset) {
        lineToWrap += lineEndReset;
      }
      wrapped.push(lineToWrap);
      if (isWhitespace) {
        // Don't start new line with whitespace
        currentLine = tracker.getActiveCodes();
        currentVisibleLength = 0;
      } else {
        currentLine = tracker.getActiveCodes() + token;
        currentVisibleLength = tokenVisibleLength;
      }
    } else {
      // Add to current line
      currentLine += token;
      currentVisibleLength += tokenVisibleLength;
    }

    updateTrackerFromText(token, tracker);
  }

  if (currentLine) {
    // No reset at end of final line - let caller handle it
    wrapped.push(currentLine);
  }

  // Trailing whitespace can cause lines to exceed the requested width
  return wrapped.length > 0 ? wrapped.map((line) => line.trimEnd()) : [""];
}
