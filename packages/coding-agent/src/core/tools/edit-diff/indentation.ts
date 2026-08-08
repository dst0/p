import * as Diff from "diff";
import {
  countOccurrences,
  extractLeadingIndent,
  fuzzyFindText,
  getDuplicateError,
  getEmptyOldTextError,
  getNoChangeError,
  getNotFoundError,
  normalizeForFuzzyMatch,
  normalizeToLF,
} from "./text-normalization.ts";
import type { AppliedEditsResult, Edit, MatchedEdit } from "./types.ts";

export function adjustNewTextIndentation(newText: string, oldText: string, originalMatchedText: string): string {
  const oldLines = oldText.split("\n").filter((l) => l.trim().length > 0);
  const origLines = originalMatchedText.split("\n").filter((l) => l.trim().length > 0);

  if (oldLines.length === 0 || origLines.length === 0) return newText;

  const oldIndent = extractLeadingIndent(oldLines[0]);
  const origIndent = extractLeadingIndent(origLines[0]);

  if (oldIndent === origIndent) return newText;

  return newText
    .split("\n")
    .map((line) => {
      if (line.trim().length === 0) return "";
      if (origIndent.startsWith(oldIndent)) {
        const indentToAdd = origIndent.slice(oldIndent.length);
        return indentToAdd + line;
      }
      if (oldIndent.startsWith(origIndent)) {
        const extraIndent = oldIndent.slice(origIndent.length);
        return line.startsWith(extraIndent) ? line.slice(extraIndent.length) : line;
      }
      return line.startsWith(oldIndent) ? origIndent + line.slice(oldIndent.length) : line;
    })
    .join("\n");
}

export function applyEditsToNormalizedContent(
  normalizedContent: string,
  edits: Edit[],
  path: string,
): AppliedEditsResult {
  const normalizedEdits = edits.map((edit) => ({
    oldText: normalizeToLF(edit.oldText),
    newText: normalizeToLF(edit.newText),
  }));

  for (let i = 0; i < normalizedEdits.length; i++) {
    if (normalizedEdits[i].oldText.length === 0) {
      throw getEmptyOldTextError(path, i, normalizedEdits.length);
    }
  }

  const initialMatches = normalizedEdits.map((edit) => fuzzyFindText(normalizedContent, edit.oldText));
  const baseContent = initialMatches.some((match) => match.usedFuzzyMatch)
    ? normalizeForFuzzyMatch(normalizedContent)
    : normalizedContent;

  const matchedEdits: MatchedEdit[] = [];
  for (let i = 0; i < normalizedEdits.length; i++) {
    const edit = normalizedEdits[i];
    const matchResult = fuzzyFindText(baseContent, edit.oldText);
    if (!matchResult.found) {
      throw getNotFoundError(path, i, normalizedEdits.length);
    }

    const occurrences = countOccurrences(baseContent, edit.oldText);
    if (occurrences > 1) {
      throw getDuplicateError(path, i, normalizedEdits.length, occurrences);
    }

    const matchedText = baseContent.substring(matchResult.index, matchResult.index + matchResult.matchLength);
    const adjustedNewText = matchResult.usedFuzzyMatch
      ? adjustNewTextIndentation(edit.newText, edit.oldText, matchedText)
      : edit.newText;

    matchedEdits.push({
      editIndex: i,
      matchIndex: matchResult.index,
      matchLength: matchResult.matchLength,
      newText: adjustedNewText,
    });
  }

  matchedEdits.sort((a, b) => a.matchIndex - b.matchIndex);
  for (let i = 1; i < matchedEdits.length; i++) {
    const previous = matchedEdits[i - 1];
    const current = matchedEdits[i];
    if (previous.matchIndex + previous.matchLength > current.matchIndex) {
      throw new Error(
        `edits[${previous.editIndex}] and edits[${current.editIndex}] overlap in ${path}. Merge them into one edit or target disjoint regions.`,
      );
    }
  }

  let newContent = baseContent;
  for (let i = matchedEdits.length - 1; i >= 0; i--) {
    const edit = matchedEdits[i];
    newContent =
      newContent.substring(0, edit.matchIndex) +
      edit.newText +
      newContent.substring(edit.matchIndex + edit.matchLength);
  }

  if (baseContent === newContent) {
    throw getNoChangeError(path, normalizedEdits.length);
  }

  return { baseContent, newContent };
}

export function generateUnifiedPatch(path: string, oldContent: string, newContent: string, contextLines = 4): string {
  return Diff.createTwoFilesPatch(path, path, oldContent, newContent, undefined, undefined, {
    context: contextLines,
    headerOptions: Diff.FILE_HEADERS_ONLY,
  });
}
