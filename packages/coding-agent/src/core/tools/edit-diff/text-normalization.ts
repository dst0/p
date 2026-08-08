import type { FuzzyMatchResult } from "./types.ts";

export function detectLineEnding(content: string): "\r\n" | "\n" {
  const crlfIdx = content.indexOf("\r\n");
  const lfIdx = content.indexOf("\n");
  if (lfIdx === -1) return "\n";
  if (crlfIdx === -1) return "\n";
  return crlfIdx < lfIdx ? "\r\n" : "\n";
}

export function normalizeToLF(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function restoreLineEndings(text: string, ending: "\r\n" | "\n"): string {
  return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

export function normalizeForFuzzyMatch(text: string): string {
  return (
    text
      .normalize("NFKC")
      // Strip trailing whitespace per line
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      // Smart single quotes → '
      .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
      // Smart double quotes → "
      .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
      // Various dashes/hyphens → -
      // U+2010 hyphen, U+2011 non-breaking hyphen, U+2012 figure dash,
      // U+2013 en-dash, U+2014 em-dash, U+2015 horizontal bar, U+2212 minus
      .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
      // Special spaces → regular space
      // U+00A0 NBSP, U+2002-U+200A various spaces, U+202F narrow NBSP,
      // U+205F medium math space, U+3000 ideographic space
      .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ")
  );
}

export function fuzzyFindText(content: string, oldText: string): FuzzyMatchResult {
  // Try exact match first
  const exactIndex = content.indexOf(oldText);
  if (exactIndex !== -1) {
    return {
      found: true,
      index: exactIndex,
      matchLength: oldText.length,
      usedFuzzyMatch: false,
      contentForReplacement: content,
    };
  }

  // Try fuzzy match - work entirely in normalized space
  const fuzzyContent = normalizeForFuzzyMatch(content);
  const fuzzyOldText = normalizeForFuzzyMatch(oldText);
  const fuzzyIndex = fuzzyContent.indexOf(fuzzyOldText);

  if (fuzzyIndex !== -1) {
    return {
      found: true,
      index: fuzzyIndex,
      matchLength: fuzzyOldText.length,
      usedFuzzyMatch: true,
      contentForReplacement: fuzzyContent,
    };
  }

  // Try line-trimmed fuzzy match if exact and standard fuzzy failed
  const lineTrimmedContent = fuzzyContent
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
  const lineTrimmedOldText = fuzzyOldText
    .split("\n")
    .map((line) => line.trim())
    .join("\n");

  const trimmedOccurrences = lineTrimmedContent.split(lineTrimmedOldText).length - 1;
  if (trimmedOccurrences === 1) {
    const trimmedIndex = lineTrimmedContent.indexOf(lineTrimmedOldText);
    const lineCountBeforeMatch = lineTrimmedContent.slice(0, trimmedIndex).split("\n").length - 1;
    const fuzzyContentLines = fuzzyContent.split("\n");
    let targetCharIndex = 0;
    for (let i = 0; i < lineCountBeforeMatch; i++) {
      targetCharIndex += fuzzyContentLines[i].length + 1;
    }
    const matchLineCount = lineTrimmedOldText.split("\n").length;
    let matchCharLength = 0;
    for (let i = 0; i < matchLineCount; i++) {
      matchCharLength += (fuzzyContentLines[lineCountBeforeMatch + i] ?? "").length + (i < matchLineCount - 1 ? 1 : 0);
    }
    return {
      found: true,
      index: targetCharIndex,
      matchLength: matchCharLength,
      usedFuzzyMatch: true,
      contentForReplacement: fuzzyContent,
    };
  }

  return {
    found: false,
    index: -1,
    matchLength: 0,
    usedFuzzyMatch: false,
    contentForReplacement: content,
  };
}

export function stripBom(content: string): { bom: string; text: string } {
  return content.startsWith("\uFEFF") ? { bom: "\uFEFF", text: content.slice(1) } : { bom: "", text: content };
}

export function countOccurrences(content: string, oldText: string): number {
  const fuzzyContent = normalizeForFuzzyMatch(content);
  const fuzzyOldText = normalizeForFuzzyMatch(oldText);
  return fuzzyContent.split(fuzzyOldText).length - 1;
}

export function getNotFoundError(path: string, editIndex: number, totalEdits: number): Error {
  if (totalEdits === 1) {
    return new Error(
      `Could not find the exact text in ${path}. The old text must match exactly including all whitespace and newlines.`,
    );
  }
  return new Error(
    `Could not find edits[${editIndex}] in ${path}. The oldText must match exactly including all whitespace and newlines.`,
  );
}

export function getDuplicateError(path: string, editIndex: number, totalEdits: number, occurrences: number): Error {
  if (totalEdits === 1) {
    return new Error(
      `Found ${occurrences} occurrences of the text in ${path}. The text must be unique. Please provide more context to make it unique.`,
    );
  }
  return new Error(
    `Found ${occurrences} occurrences of edits[${editIndex}] in ${path}. Each oldText must be unique. Please provide more context to make it unique.`,
  );
}

export function getEmptyOldTextError(path: string, editIndex: number, totalEdits: number): Error {
  if (totalEdits === 1) {
    return new Error(`oldText must not be empty in ${path}.`);
  }
  return new Error(`edits[${editIndex}].oldText must not be empty in ${path}.`);
}

export function getNoChangeError(path: string, totalEdits: number): Error {
  if (totalEdits === 1) {
    return new Error(
      `No changes made to ${path}. The replacement produced identical content. This might indicate an issue with special characters or the text not existing as expected.`,
    );
  }
  return new Error(`No changes made to ${path}. The replacements produced identical content.`);
}

export function extractLeadingIndent(line: string): string {
  const match = line.match(/^[ \t]+/);
  return match ? match[0] : "";
}
