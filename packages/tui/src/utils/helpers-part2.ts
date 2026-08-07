import { graphemeSegmenter, WIDTH_CACHE_SIZE, widthCache } from "./constants.ts";
import { extractAnsiCode, graphemeWidth, isPrintableAscii } from "./helpers-part1.ts";

export function truncateFragmentToWidth(text: string, maxWidth: number): { text: string; width: number } {
  if (isPrintableAscii(text)) {
    const clipped = text.slice(0, maxWidth);
    return { text: clipped, width: clipped.length };
  }

  const hasAnsi = text.includes("\x1b");
  const hasTabs = text.includes("\t");
  if (!hasAnsi && !hasTabs) {
    let result = "";
    let width = 0;
    for (const { segment } of graphemeSegmenter.segment(text)) {
      const w = graphemeWidth(segment);
      if (width + w > maxWidth) {
        break;
      }
      result += segment;
      width += w;
    }
    return { text: result, width };
  }

  let result = "";
  let width = 0;
  let i = 0;
  let pendingAnsi = "";

  while (i < text.length) {
    const ansi = extractAnsiCode(text, i);
    if (ansi) {
      pendingAnsi += ansi.code;
      i += ansi.length;
      continue;
    }

    if (text[i] === "\t") {
      if (width + 4 > maxWidth) {
        break;
      }
      if (pendingAnsi) {
        result += pendingAnsi;
        pendingAnsi = "";
      }
      result += "\t";
      width += 4;
      i++;
      continue;
    }

    let end = i;
    while (end < text.length && text[end] !== "\t") {
      const nextAnsi = extractAnsiCode(text, end);
      if (nextAnsi) {
        break;
      }
      end++;
    }

    for (const { segment } of graphemeSegmenter.segment(text.slice(i, end))) {
      const w = graphemeWidth(segment);
      if (width + w > maxWidth) {
        return { text: result, width };
      }
      if (pendingAnsi) {
        result += pendingAnsi;
        pendingAnsi = "";
      }
      result += segment;
      width += w;
    }
    i = end;
  }

  return { text: result, width };
}

export function visibleWidth(str: string): number {
  if (str.length === 0) {
    return 0;
  }

  // Fast path: pure ASCII printable
  if (isPrintableAscii(str)) {
    return str.length;
  }

  // Check cache
  const cached = widthCache.get(str);
  if (cached !== undefined) {
    return cached;
  }

  // Normalize: tabs to 4 spaces, strip ANSI escape codes
  let clean = str;
  if (str.includes("\t")) {
    clean = clean.replace(/\t/g, "    ");
  }
  if (clean.includes("\x1b")) {
    // Strip supported ANSI/OSC/APC escape sequences in one pass.
    // This covers CSI styling/cursor codes, OSC hyperlinks and prompt markers,
    // and APC sequences like CURSOR_MARKER.
    let stripped = "";
    let i = 0;
    while (i < clean.length) {
      const ansi = extractAnsiCode(clean, i);
      if (ansi) {
        i += ansi.length;
        continue;
      }
      stripped += clean[i];
      i++;
    }
    clean = stripped;
  }

  // Calculate width
  let width = 0;
  for (const { segment } of graphemeSegmenter.segment(clean)) {
    width += graphemeWidth(segment);
  }

  // Cache result
  if (widthCache.size >= WIDTH_CACHE_SIZE) {
    const firstKey = widthCache.keys().next().value;
    if (firstKey !== undefined) {
      widthCache.delete(firstKey);
    }
  }
  widthCache.set(str, width);

  return width;
}
