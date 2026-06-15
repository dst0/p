/**
 * easy-edit — Position-based file editing tools for Pi
 */

import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, relative, resolve, dirname, basename } from "node:path";

// ──────────────────────────────────────────────
//  Types
// ──────────────────────────────────────────────

interface Position {
  line: number;     // 1-based
  position: number; // 0-based column offset
}

// ──────────────────────────────────────────────
//  Backup / revert infrastructure
// ──────────────────────────────────────────────

function getEditsDir(cwd: string): string {
  const editsDir = join(cwd, ".pi", "edits");
  mkdirSync(editsDir, { recursive: true });
  return editsDir;
}

function createBackup(filePath: string, cwd: string): string {
  const absFile = resolve(cwd, filePath);
  const editsDir = getEditsDir(cwd);
  const relPath = relative(cwd, absFile);
  const backupDir = join(editsDir, dirname(relPath));
  mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = join(backupDir, `${basename(relPath)}@${timestamp}`);
  copyFileSync(absFile, backupPath);
  return backupPath;
}

function revertFile(filePath: string, cwd: string): string | null {
  const absFile = resolve(cwd, filePath);
  const editsDir = getEditsDir(cwd);
  const relPath = relative(cwd, absFile);
  const backupDir = join(editsDir, dirname(relPath));
  const resolvedBackupDir = resolve(backupDir);
  if (!existsSync(resolvedBackupDir)) return null;
  const files = readdirSync(resolvedBackupDir)
    .filter((f: string) => f.includes(basename(absFile) + "@"))
    .sort()
    .reverse();
  if (files.length === 0) return null;
  const latestBackup = join(resolvedBackupDir, files[0]);
  copyFileSync(latestBackup, absFile);
  return latestBackup;
}

import { existsSync } from "node:fs";

// ──────────────────────────────────────────────
//  Position helpers
// ──────────────────────────────────────────────

function posToOffset(content: string, pos: Position): number {
  const lines = content.split("\n");
  let offset = 0;
  for (let i = 0; i < pos.line - 1 && i < lines.length; i++) {
    offset += lines[i].length + 1;
  }
  offset += pos.position;
  return Math.min(offset, content.length);
}

function readFile(filePath: string, cwd: string): { content: string; lines: string[] } {
  const abs = resolve(cwd, filePath);
  const content = readFileSync(abs, "utf-8");
  return { content, lines: content.split("\n") };
}

// ──────────────────────────────────────────────
//  Mutation helpers
// ──────────────────────────────────────────────

function doInsert(content: string, pos: Position, text: string): string {
  const offset = posToOffset(content, pos);
  return content.slice(0, offset) + text + content.slice(offset);
}

function doReplace(content: string, start: Position, end: Position, newText: string): string {
  const startOffset = posToOffset(content, start);
  const endOffset = posToOffset(content, end);
  return content.slice(0, startOffset) + newText + content.slice(endOffset);
}

function doReplaceByLength(content: string, start: Position, length: number, newText: string): string {
  const startOffset = posToOffset(content, start);
  const endOffset = Math.min(startOffset + length, content.length);
  return content.slice(0, startOffset) + newText + content.slice(endOffset);
}

const PositionSchema = Type.Object({
  line: Type.Integer({ description: "Line number (1-based)" }),
  position: Type.Integer({ description: "Column offset (0-based)" }),
});

let clipboard: { text: string; source: string } | null = null;

// ──────────────────────────────────────────────
//  Tools
// ──────────────────────────────────────────────

const findTool = defineTool({
  name: "easy:find",
  label: "Easy Find",
  description: "Find occurrences of text in a file. Returns precise {line, position} ranges.",
  parameters: Type.Object({
    file: Type.String(),
    pattern: Type.String(),
    maxResults: Type.Optional(Type.Integer({ default: 10 })),
  }),
  async execute(_id, params, _sig, _up, ctx) {
    const { file, pattern, maxResults = 10 } = params;
    const { content } = readFile(file, ctx.cwd);
    const matches: any[] = [];
    let searchStart = 0;
    while (matches.length < maxResults) {
      const idx = content.indexOf(pattern, searchStart);
      if (idx === -1) break;
      let line = 1, col = 0;
      for (let i = 0; i < idx; i++) { if (content[i] === "\n") { line++; col = 0; } else col++; }
      let eLine = line, eCol = col;
      for (let i = 0; i < pattern.length; i++) { if (pattern[i] === "\n") { eLine++; eCol = 0; } else eCol++; }
      matches.push({ start: { line, position: col }, end: { line: eLine, position: eCol }, length: pattern.length });
      searchStart = idx + 1;
    }
    return { content: [{ type: "text", text: `Found ${matches.length} matches for "${pattern}" in ${file}\n\n${JSON.stringify(matches, null, 2)}` }], details: { matches } };
  }
});

const copyTool = defineTool({
  name: "easy:copy",
  label: "Easy Copy",
  description: "Copy text region to internal clipboard.",
  parameters: Type.Object({
    file: Type.String(),
    start: PositionSchema,
    end: Type.Optional(PositionSchema),
    length: Type.Optional(Type.Integer()),
  }),
  async execute(_id, params, _sig, _up, ctx) {
    const { file, start, end, length } = params;
    const { content } = readFile(file, ctx.cwd);
    const sOff = posToOffset(content, start);
    const eOff = end ? posToOffset(content, end) : (length !== undefined ? sOff + length : sOff);
    const text = content.slice(sOff, eOff);
    createBackup(file, ctx.cwd);
    clipboard = { text, source: file };
    return { content: [{ type: "text", text: `Copied ${text.length} chars from ${file}` }] };
  }
});

const pasteTool = defineTool({
  name: "easy:paste",
  label: "Easy Paste",
  description: "Paste clipboard text at position.",
  parameters: Type.Object({ file: Type.String(), start: PositionSchema }),
  async execute(_id, params, _sig, _up, ctx) {
    if (!clipboard) return { content: [{ type: "text", text: "Clipboard empty" }] };
    const { file, start } = params;
    const { content } = readFile(file, ctx.cwd);
    createBackup(file, ctx.cwd);
    const newContent = doInsert(content, start, clipboard.text);
    writeFileSync(resolve(ctx.cwd, file), newContent, "utf-8");
    return { content: [{ type: "text", text: `Pasted ${clipboard.text.length} chars into ${file}` }] };
  }
});

const insertTool = defineTool({
  name: "easy:insert",
  label: "Easy Insert",
  description: "Insert text at position.",
  parameters: Type.Object({ file: Type.String(), start: PositionSchema, text: Type.String() }),
  async execute(_id, params, _sig, _up, ctx) {
    const { file, start, text } = params;
    const { content } = readFile(file, ctx.cwd);
    createBackup(file, ctx.cwd);
    const newContent = doInsert(content, start, text);
    writeFileSync(resolve(ctx.cwd, file), newContent, "utf-8");
    return { content: [{ type: "text", text: `Inserted ${text.length} chars into ${file}` }] };
  }
});

const replaceTool = defineTool({
  name: "easy:replace",
  label: "Easy Replace",
  description: "Replace region with text.",
  parameters: Type.Object({
    file: Type.String(),
    start: PositionSchema,
    end: Type.Optional(PositionSchema),
    length: Type.Optional(Type.Integer()),
    text: Type.String(),
  }),
  async execute(_id, params, _sig, _up, ctx) {
    const { file, start, end, length, text } = params;
    const { content } = readFile(file, ctx.cwd);
    createBackup(file, ctx.cwd);
    const newContent = end ? doReplace(content, start, end, text) : doReplaceByLength(content, start, length ?? 0, text);
    writeFileSync(resolve(ctx.cwd, file), newContent, "utf-8");
    return { content: [{ type: "text", text: `Replaced text in ${file}` }] };
  }
});

const revertTool = defineTool({
  name: "easy:revert",
  label: "Easy Revert",
  description: "Revert file to last backup.",
  parameters: Type.Object({ file: Type.String() }),
  async execute(_id, params, _sig, _up, ctx) {
    const res = revertFile(params.file, ctx.cwd);
    return { content: [{ type: "text", text: res ? `Reverted from ${res}` : "No backup found" }] };
  }
});

export default function (pi: ExtensionAPI) {
  pi.registerTool(findTool);
  pi.registerTool(copyTool);
  pi.registerTool(pasteTool);
  pi.registerTool(insertTool);
  pi.registerTool(replaceTool);
  pi.registerTool(revertTool);

  pi.on("resources_discover", () => {
    return {
      skillPaths: [join(__dirname, "SKILL.md")],
    };
  });
}
