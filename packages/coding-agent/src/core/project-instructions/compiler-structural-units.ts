import { consumeMarkdownFence, createMarkdownFenceState, getMarkdownHeadingMarker } from "./markdown-structure.ts";

const MARKDOWN_LIST_ITEM_PATTERN = /^(\s*)(?:[-*+]|\d+[.)])\s+\S/u;

export interface ProjectInstructionHeadingUnit {
  kind: "heading";
  content: string;
  level: number;
  sourceText: string;
  sourceEndOffset: number;
  sourceStartOffset: number;
  startOffset: number;
}

export interface ProjectInstructionContentUnit {
  kind: "content";
  content: string;
  sourceText: string;
  sourceEndOffset: number;
  sourceStartOffset: number;
  startOffset: number;
}

export type ProjectInstructionStructuralUnit = ProjectInstructionHeadingUnit | ProjectInstructionContentUnit;

interface PendingContentUnit {
  lines: string[];
  listContentColumn?: number;
  listIndent?: number;
  pendingBlankStartOffset?: number;
  pendingBlankLines: number;
  sourceStartOffset: number;
  startOffset: number;
}

export interface ProjectInstructionStructuralScan {
  units: ProjectInstructionStructuralUnit[];
  splitOffsets: number[];
}

export function scanProjectInstructionStructuralUnits(source: string): ProjectInstructionStructuralScan {
  const units: ProjectInstructionStructuralUnit[] = [];
  const splitOffsets = new Set<number>();
  const fence = createMarkdownFenceState();
  const lines = source.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? [];
  let lineOffset = 0;
  let unclaimedOffset = 0;
  let pending: PendingContentUnit | undefined;
  const flush = (boundaryOffset: number): void => {
    if (!pending) return;
    units.push({
      kind: "content",
      content: pending.lines.join("\n"),
      sourceEndOffset: boundaryOffset,
      sourceStartOffset: pending.sourceStartOffset,
      sourceText: source.slice(pending.sourceStartOffset, boundaryOffset),
      startOffset: pending.startOffset,
    });
    pending = undefined;
    unclaimedOffset = boundaryOffset;
    if (boundaryOffset > 0) splitOffsets.add(boundaryOffset);
  };

  for (const lineWithEnding of lines) {
    const currentLineOffset = lineOffset;
    lineOffset += lineWithEnding.length;
    const sourceLine = lineWithEnding.replace(/(?:\r\n|\r|\n)$/u, "");
    const content = sourceLine.trim();
    const fenceEvent = consumeMarkdownFence(sourceLine, fence);
    if (fenceEvent === "open") {
      if (pending?.pendingBlankLines) {
        const indentation = visualIndentation(/^\s*/u.exec(sourceLine)?.[0] ?? "");
        if (pending.listContentColumn !== undefined && indentation >= pending.listContentColumn) {
          pending.lines.push(...Array.from({ length: pending.pendingBlankLines }, () => ""), sourceLine);
          pending.pendingBlankLines = 0;
          pending.pendingBlankStartOffset = undefined;
          continue;
        }
        flush(pending.pendingBlankStartOffset ?? currentLineOffset);
      } else {
        flush(currentLineOffset);
      }
      pending = {
        lines: [sourceLine],
        pendingBlankLines: 0,
        sourceStartOffset: unclaimedOffset,
        startOffset: currentLineOffset,
      };
      continue;
    }
    if (fenceEvent === "inside") {
      if (!pending) {
        pending = {
          lines: [],
          pendingBlankLines: 0,
          sourceStartOffset: unclaimedOffset,
          startOffset: currentLineOffset,
        };
      }
      pending.lines.push(sourceLine);
      continue;
    }
    if (fenceEvent === "close") {
      if (!pending) {
        pending = {
          lines: [],
          pendingBlankLines: 0,
          sourceStartOffset: unclaimedOffset,
          startOffset: currentLineOffset,
        };
      }
      pending.lines.push(sourceLine);
      flush(lineOffset);
      continue;
    }
    if (!content) {
      if (pending?.listContentColumn !== undefined) {
        pending.pendingBlankStartOffset ??= currentLineOffset;
        pending.pendingBlankLines += 1;
      } else {
        flush(currentLineOffset);
      }
      continue;
    }
    if (pending?.pendingBlankLines) {
      const indentation = visualIndentation(/^\s*/u.exec(sourceLine)?.[0] ?? "");
      if (pending.listContentColumn !== undefined && indentation >= pending.listContentColumn) {
        pending.lines.push(...Array.from({ length: pending.pendingBlankLines }, () => ""));
        pending.pendingBlankLines = 0;
        pending.pendingBlankStartOffset = undefined;
      } else {
        flush(pending.pendingBlankStartOffset ?? currentLineOffset);
      }
    }
    const headingMarker = getMarkdownHeadingMarker(sourceLine);
    if (headingMarker) {
      flush(currentLineOffset);
      units.push({
        kind: "heading",
        content: sourceLine,
        level: headingMarker.length,
        sourceEndOffset: lineOffset,
        sourceStartOffset: unclaimedOffset,
        sourceText: source.slice(unclaimedOffset, lineOffset),
        startOffset: currentLineOffset,
      });
      unclaimedOffset = lineOffset;
      continue;
    }
    const listMatch = MARKDOWN_LIST_ITEM_PATTERN.exec(sourceLine);
    const listIndent = listMatch === null ? undefined : visualIndentation(listMatch[1] ?? "");
    const listContentColumn = listMatch === null ? undefined : visualIndentation(listMatch[0].slice(0, -1));
    if (pending && listIndent !== undefined && (pending.listIndent === undefined || listIndent <= pending.listIndent)) {
      flush(currentLineOffset);
    }
    if (pending) pending.lines.push(sourceLine);
    else {
      pending = {
        lines: [sourceLine],
        listContentColumn,
        listIndent,
        pendingBlankLines: 0,
        sourceStartOffset: unclaimedOffset,
        startOffset: currentLineOffset,
      };
    }
  }
  flush(source.length);
  const lastUnit = units.at(-1);
  if (lastUnit && unclaimedOffset < source.length) {
    lastUnit.sourceText += source.slice(unclaimedOffset);
    lastUnit.sourceEndOffset = source.length;
  }
  splitOffsets.add(source.length);
  return { units, splitOffsets: [...splitOffsets].sort((left, right) => left - right) };
}

function visualIndentation(whitespace: string): number {
  let column = 0;
  for (const character of whitespace) {
    column += character === "\t" ? 4 - (column % 4) : 1;
  }
  return column;
}
