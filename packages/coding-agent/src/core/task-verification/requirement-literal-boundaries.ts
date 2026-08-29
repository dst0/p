interface LiteralSpan {
  start: number;
  end: number;
  delimiterLength: number;
  kind: "code" | "quote";
}

interface ScanLiteralOptions {
  scanQuotes?: boolean;
  scanCodeSpans?: boolean;
}

function scanLiteralSpans(text: string, options: ScanLiteralOptions = {}): LiteralSpan[] {
  const { scanQuotes = true, scanCodeSpans = true } = options;
  const spans: LiteralSpan[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    if (scanCodeSpans && text[i] === "`") {
      let runLen = 0;
      while (i + runLen < text.length && text[i + runLen] === "`") {
        runLen++;
      }
      let searchPos = i + runLen;
      let foundClose = -1;
      while (searchPos < text.length) {
        if (text[searchPos] === "`") {
          let closeLen = 0;
          while (searchPos + closeLen < text.length && text[searchPos + closeLen] === "`") {
            closeLen++;
          }
          if (closeLen === runLen) {
            foundClose = searchPos;
            break;
          }
          searchPos += closeLen;
        } else {
          searchPos++;
        }
      }
      if (foundClose !== -1) {
        spans.push({
          start: i,
          end: foundClose + runLen,
          delimiterLength: runLen,
          kind: "code",
        });
        i = foundClose + runLen;
        continue;
      }
      i += runLen;
      continue;
    }
    const closingQuote = scanQuotes ? closingQuoteFor(text[i]) : undefined;
    if (closingQuote && isScalarQuoteOpener(text, i)) {
      const openingQuote = text[i];
      let searchPos = i + 1;
      let foundClose = -1;
      while (searchPos < text.length) {
        if (text[searchPos] === "\\") {
          searchPos += 2;
        } else if (
          text[searchPos] === closingQuote &&
          !((openingQuote === "'" || openingQuote === "‘") && isInternalApostrophe(text, searchPos))
        ) {
          foundClose = searchPos;
          break;
        } else {
          searchPos++;
        }
      }
      if (foundClose !== -1) {
        spans.push({
          start: i,
          end: foundClose + 1,
          delimiterLength: 1,
          kind: "quote",
        });
        i = foundClose + 1;
        continue;
      }
      i++;
      continue;
    }
    i++;
  }
  return spans;
}

export function maskScalarLiterals(text: string): string {
  const spans = scanLiteralSpans(text, { scanQuotes: true, scanCodeSpans: true });
  if (spans.length === 0) return text;
  const chars = text.split("");
  for (const span of spans) {
    const contentStart = span.start + span.delimiterLength;
    const contentEnd = span.end - span.delimiterLength;
    for (let k = contentStart; k < contentEnd; k++) {
      chars[k] = " ";
    }
  }
  return chars.join("");
}

export function splitSourceClauses(text: string): string[] {
  const literalSpans = scanLiteralSpans(text, { scanQuotes: true, scanCodeSpans: true });
  const parts: string[] = [];
  let spanIndex = 0;
  let lastSplitEnd = 0;
  let i = 0;
  while (i < text.length) {
    if (spanIndex < literalSpans.length && i >= literalSpans[spanIndex]!.start) {
      i = literalSpans[spanIndex]!.end;
      spanIndex++;
      continue;
    }
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    if (text[i] === ";") {
      parts.push(text.slice(lastSplitEnd, i));
      lastSplitEnd = i + 1;
      i++;
      continue;
    }
    if (text[i] === "." || text[i] === "!" || text[i] === "?") {
      let punctEnd = i + 1;
      while (punctEnd < text.length && (text[punctEnd] === "." || text[punctEnd] === "!" || text[punctEnd] === "?")) {
        punctEnd++;
      }
      if (punctEnd < text.length && /\s/u.test(text[punctEnd]!)) {
        let wsEnd = punctEnd + 1;
        while (wsEnd < text.length && /\s/u.test(text[wsEnd]!)) {
          wsEnd++;
        }
        parts.push(text.slice(lastSplitEnd, punctEnd));
        lastSplitEnd = wsEnd;
        i = wsEnd;
        continue;
      }
      i = punctEnd;
      continue;
    }
    i++;
  }
  parts.push(text.slice(lastSplitEnd));
  return parts;
}

function closingQuoteFor(value: string | undefined): string | undefined {
  if (value === '"' || value === "'") return value;
  if (value === "“") return "”";
  if (value === "‘") return "’";
  return undefined;
}

function isScalarQuoteOpener(text: string, index: number): boolean {
  if (text[index] === '"') {
    const previous = text[index - 1];
    if (previous !== undefined && /\p{N}/u.test(previous)) return false;
  }
  if (text[index] !== "'") return true;
  const previous = text[index - 1];
  return previous === undefined || !/[\p{L}\p{N}]/u.test(previous);
}

function isInternalApostrophe(text: string, index: number): boolean {
  const previous = text[index - 1];
  const next = text[index + 1];
  return previous !== undefined && next !== undefined && /[\p{L}\p{N}]/u.test(previous) && /[\p{L}\p{N}]/u.test(next);
}
