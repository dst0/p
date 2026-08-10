import { cjkBreakRegex, isWhitespaceChar, visibleWidth } from "../../utils.ts";
import { graphemeSegmenter, PASTE_MARKER_REGEX, PASTE_MARKER_SINGLE } from "./constants.ts";
import type { TextChunk } from "./types.ts";

export function isPasteMarker(segment: string): boolean {
  return segment.length >= 10 && PASTE_MARKER_SINGLE.test(segment);
}

export function segmentWithMarkers(
  text: string,
  baseSegmenter: Intl.Segmenter,
  validIds: Set<number>,
): Iterable<Intl.SegmentData> {
  // Fast path: no paste markers in the text or no valid IDs.
  if (validIds.size === 0 || !text.includes("[paste #")) {
    return baseSegmenter.segment(text);
  }

  // Find all marker spans with valid IDs.
  const markers: Array<{ start: number; end: number }> = [];
  for (const m of text.matchAll(PASTE_MARKER_REGEX)) {
    const id = Number.parseInt(m[1]!, 10);
    if (!validIds.has(id)) continue;
    markers.push({ start: m.index, end: m.index + m[0].length });
  }
  if (markers.length === 0) {
    return baseSegmenter.segment(text);
  }

  // Build merged segment list.
  const baseSegments = baseSegmenter.segment(text);
  const result: Intl.SegmentData[] = [];
  let markerIdx = 0;

  for (const seg of baseSegments) {
    // Skip past markers that are entirely before this segment.
    while (markerIdx < markers.length && markers[markerIdx]!.end <= seg.index) {
      markerIdx++;
    }

    const marker = markerIdx < markers.length ? markers[markerIdx]! : null;

    if (marker && seg.index >= marker.start && seg.index < marker.end) {
      // This segment falls inside a marker.
      // If this is the first segment of the marker, emit a merged segment.
      if (seg.index === marker.start) {
        const markerText = text.slice(marker.start, marker.end);
        result.push({
          segment: markerText,
          index: marker.start,
          input: text,
        });
      }
      // Otherwise skip (already merged into the first segment).
    } else {
      result.push(seg);
    }
  }

  return result;
}

export function wordWrapLine(line: string, maxWidth: number, preSegmented?: Intl.SegmentData[]): TextChunk[] {
  if (!line || maxWidth <= 0) {
    return [{ text: "", startIndex: 0, endIndex: 0 }];
  }

  const lineWidth = visibleWidth(line);
  if (lineWidth <= maxWidth) {
    return [{ text: line, startIndex: 0, endIndex: line.length }];
  }

  const chunks: TextChunk[] = [];
  const segments = preSegmented ?? [...graphemeSegmenter.segment(line)];

  let currentWidth = 0;
  let chunkStart = 0;

  // Wrap opportunity: the position after the last whitespace before a non-whitespace
  // grapheme, i.e. where a line break is allowed.
  let wrapOppIndex = -1;
  let wrapOppWidth = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const grapheme = seg.segment;
    const gWidth = visibleWidth(grapheme);
    const charIndex = seg.index;
    const isWs = !isPasteMarker(grapheme) && isWhitespaceChar(grapheme);

    // Overflow check before advancing.
    if (currentWidth + gWidth > maxWidth) {
      if (wrapOppIndex >= 0 && currentWidth - wrapOppWidth + gWidth <= maxWidth) {
        // Backtrack to last wrap opportunity (the remaining content
        // plus the current grapheme still fits within maxWidth).
        chunks.push({ text: line.slice(chunkStart, wrapOppIndex), startIndex: chunkStart, endIndex: wrapOppIndex });
        chunkStart = wrapOppIndex;
        currentWidth -= wrapOppWidth;
      } else if (chunkStart < charIndex) {
        // No viable wrap opportunity: force-break at current position.
        // This also handles the case where backtracking to a word
        // boundary wouldn't help because the remaining content plus
        // the current grapheme (e.g. a wide character) still exceeds
        // maxWidth.
        chunks.push({ text: line.slice(chunkStart, charIndex), startIndex: chunkStart, endIndex: charIndex });
        chunkStart = charIndex;
        currentWidth = 0;
      }
      wrapOppIndex = -1;
    }

    if (gWidth > maxWidth) {
      // Single atomic segment wider than maxWidth (e.g. paste marker
      // in a narrow terminal). Re-wrap it at grapheme granularity.

      // The segment remains logically atomic for cursor
      // movement / editing — the split is purely visual for word-wrap layout.
      const subChunks = wordWrapLine(grapheme, maxWidth);
      for (let j = 0; j < subChunks.length - 1; j++) {
        const sc = subChunks[j]!;
        chunks.push({ text: sc.text, startIndex: charIndex + sc.startIndex, endIndex: charIndex + sc.endIndex });
      }
      const last = subChunks[subChunks.length - 1]!;
      chunkStart = charIndex + last.startIndex;
      currentWidth = visibleWidth(last.text);
      wrapOppIndex = -1;
      continue;
    }

    // Advance.
    currentWidth += gWidth;

    // Record wrap opportunity: whitespace followed by non-whitespace
    // (multiple spaces join; the break point is after the last space),
    // or at a boundary where either side is CJK (CJK allows breaking
    // between any adjacent characters).
    const next = segments[i + 1];
    if (isWs && next && (isPasteMarker(next.segment) || !isWhitespaceChar(next.segment))) {
      wrapOppIndex = next.index;
      wrapOppWidth = currentWidth;
    } else if (!isWs && next && !isWhitespaceChar(next.segment)) {
      const isCjk = !isPasteMarker(grapheme) && cjkBreakRegex.test(grapheme);
      const nextIsCjk = !isPasteMarker(next.segment) && cjkBreakRegex.test(next.segment);
      if (isCjk || nextIsCjk) {
        wrapOppIndex = next.index;
        wrapOppWidth = currentWidth;
      }
    }
  }

  // Push final chunk.
  chunks.push({ text: line.slice(chunkStart), startIndex: chunkStart, endIndex: line.length });

  return chunks;
}
