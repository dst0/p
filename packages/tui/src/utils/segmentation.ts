import { eastAsianWidth } from "get-east-asian-width";
import {
  graphemeSegmenter,
  leadingNonPrintingRegex,
  rgiEmojiRegex,
  wordSegmenter,
  zeroWidthRegex,
} from "./constants.ts";

export function getGraphemeSegmenter(): Intl.Segmenter {
  return graphemeSegmenter;
}

export function getWordSegmenter(): Intl.Segmenter {
  return wordSegmenter;
}

export function couldBeEmoji(segment: string): boolean {
  const cp = segment.codePointAt(0)!;
  return (
    (cp >= 0x1f000 && cp <= 0x1fbff) || // Emoji and Pictograph
    (cp >= 0x2300 && cp <= 0x23ff) || // Misc technical
    (cp >= 0x2600 && cp <= 0x27bf) || // Misc symbols, dingbats
    (cp >= 0x2b50 && cp <= 0x2b55) || // Specific stars/circles
    segment.includes("\uFE0F") || // Contains VS16 (emoji presentation selector)
    segment.length > 2 // Multi-codepoint sequences (ZWJ, skin tones, etc.)
  );
}

export function isPrintableAscii(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) {
      return false;
    }
  }
  return true;
}

export function graphemeWidth(segment: string): number {
  if (segment === "\t") {
    return 4;
  }

  // Zero-width clusters
  if (zeroWidthRegex.test(segment)) {
    return 0;
  }

  // Emoji check with pre-filter
  if (couldBeEmoji(segment) && rgiEmojiRegex.test(segment)) {
    return 2;
  }

  // Get base visible codepoint
  const base = segment.replace(leadingNonPrintingRegex, "");
  const cp = base.codePointAt(0);
  if (cp === undefined) {
    return 0;
  }

  // Regional indicator symbols (U+1F1E6..U+1F1FF) are often rendered as
  // full-width emoji in terminals, even when isolated during streaming.
  // Keep width conservative (2) to avoid terminal auto-wrap drift artifacts.
  if (cp >= 0x1f1e6 && cp <= 0x1f1ff) {
    return 2;
  }

  let width = eastAsianWidth(cp);

  // Trailing halfwidth/fullwidth forms and AM vowels that segment with a base.
  if (segment.length > 1) {
    for (const char of segment.slice(1)) {
      const c = char.codePointAt(0)!;
      if (c >= 0xff00 && c <= 0xffef) {
        width += eastAsianWidth(c);
      } else if (c === 0x0e33 || c === 0x0eb3) {
        width += 1;
      }
    }
  }

  return width;
}

export function extractAnsiCode(str: string, pos: number): { code: string; length: number } | null {
  if (pos >= str.length || str[pos] !== "\x1b") return null;

  const next = str[pos + 1];

  // CSI sequence: ESC [ ... m/G/K/H/J
  if (next === "[") {
    let j = pos + 2;
    while (j < str.length) {
      const c = str[j]!;
      if (c === "m" || c === "G" || c === "K" || c === "H" || c === "J") {
        return { code: str.substring(pos, j + 1), length: j + 1 - pos };
      }
      j++;
    }
    return null;
  }

  // OSC sequence: ESC ] ... BEL or ESC ] ... ST (ESC \)
  // Used for hyperlinks (OSC 8), window titles, etc.
  if (next === "]") {
    let j = pos + 2;
    while (j < str.length) {
      if (str[j] === "\x07") return { code: str.substring(pos, j + 1), length: j + 1 - pos };
      if (str[j] === "\x1b" && str[j + 1] === "\\") return { code: str.substring(pos, j + 2), length: j + 2 - pos };
      j++;
    }
    return null;
  }

  // APC sequence: ESC _ ... BEL or ESC _ ... ST (ESC \)
  // Used for cursor marker and application-specific commands
  if (next === "_") {
    let j = pos + 2;
    while (j < str.length) {
      if (str[j] === "\x07") return { code: str.substring(pos, j + 1), length: j + 1 - pos };
      if (str[j] === "\x1b" && str[j + 1] === "\\") return { code: str.substring(pos, j + 2), length: j + 2 - pos };
      j++;
    }
    return null;
  }

  return null;
}
