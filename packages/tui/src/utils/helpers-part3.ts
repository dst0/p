import type { AnsiCodeTracker } from "./ansicodetracker.ts";
import { cjkBreakRegex, graphemeSegmenter, THAI_LAO_AM_GLOBAL_REGEX, THAI_LAO_AM_REGEX } from "./constants.ts";
import { extractAnsiCode } from "./helpers-part1.ts";
import type { ActiveHyperlink, Osc8Terminator } from "./types.ts";

export function finalizeTruncatedResult(
  prefix: string,
  prefixWidth: number,
  ellipsis: string,
  ellipsisWidth: number,
  maxWidth: number,
  pad: boolean,
): string {
  const reset = "\x1b[0m";
  const visibleWidth = prefixWidth + ellipsisWidth;
  let result: string;

  if (ellipsis.length > 0) {
    result = `${prefix}${reset}${ellipsis}${reset}`;
  } else {
    result = `${prefix}${reset}`;
  }

  return pad ? result + " ".repeat(Math.max(0, maxWidth - visibleWidth)) : result;
}

export function normalizeTerminalOutput(str: string): string {
  if (!THAI_LAO_AM_REGEX.test(str)) return str;
  return str.replace(THAI_LAO_AM_GLOBAL_REGEX, (char) => (char === "\u0e33" ? "\u0e4d\u0e32" : "\u0ecd\u0eb2"));
}

export function parseOsc8Hyperlink(ansiCode: string): ActiveHyperlink | null | undefined {
  if (!ansiCode.startsWith("\x1b]8;")) {
    return undefined;
  }

  const terminator: Osc8Terminator = ansiCode.endsWith("\x07") ? "\x07" : "\x1b\\";
  const body = ansiCode.slice(4, terminator === "\x07" ? -1 : -2);
  const separatorIndex = body.indexOf(";");
  if (separatorIndex === -1) {
    return undefined;
  }

  const params = body.slice(0, separatorIndex);
  const url = body.slice(separatorIndex + 1);
  if (!url) {
    return null;
  }
  return { params, url, terminator };
}

export function formatOsc8Hyperlink(hyperlink: ActiveHyperlink): string {
  return `\x1b]8;${hyperlink.params};${hyperlink.url}${hyperlink.terminator}`;
}

export function formatOsc8Close(terminator: Osc8Terminator): string {
  return `\x1b]8;;${terminator}`;
}

export function updateTrackerFromText(text: string, tracker: AnsiCodeTracker): void {
  let i = 0;
  while (i < text.length) {
    const ansiResult = extractAnsiCode(text, i);
    if (ansiResult) {
      tracker.process(ansiResult.code);
      i += ansiResult.length;
    } else {
      i++;
    }
  }
}

export function splitIntoTokensWithAnsi(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let pendingAnsi = ""; // ANSI codes waiting to be attached to next visible content
  let currentKind: "space" | "word" | null = null;
  let i = 0;

  const flushCurrent = (): void => {
    if (!current) {
      return;
    }
    tokens.push(current);
    current = "";
    currentKind = null;
  };

  while (i < text.length) {
    const ansiResult = extractAnsiCode(text, i);
    if (ansiResult) {
      // Hold ANSI codes separately - they'll be attached to the next visible char
      pendingAnsi += ansiResult.code;
      i += ansiResult.length;
      continue;
    }

    let end = i;
    while (end < text.length && !extractAnsiCode(text, end)) {
      end++;
    }

    for (const { segment } of graphemeSegmenter.segment(text.slice(i, end))) {
      const segmentIsSpace = segment === " ";
      if (!segmentIsSpace && cjkBreakRegex.test(segment)) {
        flushCurrent();
        const token = pendingAnsi + segment;
        pendingAnsi = "";
        tokens.push(token);
        continue;
      }

      const segmentKind = segmentIsSpace ? "space" : "word";
      if (current && currentKind !== segmentKind) {
        flushCurrent();
      }

      // Attach any pending ANSI codes to this visible character
      if (pendingAnsi) {
        current += pendingAnsi;
        pendingAnsi = "";
      }

      currentKind = segmentKind;
      current += segment;
    }

    i = end;
  }

  // Handle any remaining pending ANSI codes (attach to last token)
  if (pendingAnsi) {
    if (current) {
      current += pendingAnsi;
    } else if (tokens.length > 0) {
      tokens[tokens.length - 1] += pendingAnsi;
    } else {
      current = pendingAnsi;
    }
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}
