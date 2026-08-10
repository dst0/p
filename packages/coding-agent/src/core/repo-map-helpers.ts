import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import type { RepoMap, RepoMapFile, SymbolRef } from "./repo-map.ts";

const REPO_MAP_VERSION = 1;
const MAX_FILES = 1_200;
const MAX_FILE_BYTES = 200_000;
const INDEX_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".cjs"]);
const QUERY_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "available",
  "based",
  "be",
  "by",
  "exactly",
  "file",
  "for",
  "from",
  "if",
  "in",
  "is",
  "it",
  "no",
  "of",
  "on",
  "only",
  "or",
  "path",
  "that",
  "the",
  "this",
  "to",
  "tools",
  "with",
]);
export const SKIP_DIRS = new Set([
  ".antigravitycli",
  ".git",
  ".idea",
  ".junie",
  ".pdev",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".cache",
]);

export function listIndexableFiles(root: string): string[] {
  const result: string[] = [];
  const visit = (dir: string): void => {
    if (result.length >= MAX_FILES) return;
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (result.length >= MAX_FILES) return;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) visit(path);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = extname(entry.name);
      if (!INDEX_EXTENSIONS.has(ext)) continue;
      const stat = statSync(path);
      if (stat.size <= MAX_FILE_BYTES) result.push(path);
    }
  };
  visit(root);
  return result;
}

export function indexFile(root: string, path: string, sha: string): RepoMapFile {
  const relativePath = relative(root, path);
  const ext = extname(path);
  const language = languageForExtension(ext);
  const text = safeRead(path);
  return {
    path: relativePath,
    language,
    imports: extractImports(text),
    exports: extractExports(text),
    summary: summarizeFile(text, relativePath),
    lastIndexedSha: sha,
  };
}

export function scoreFile(file: RepoMapFile, terms: string[]): number {
  const path = file.path.toLowerCase();
  const summary = file.summary.toLowerCase();
  const imports = file.imports.join(" ").toLowerCase();
  const exports = file.exports.map((symbol) => symbol.name.toLowerCase());
  let score = 0;
  for (const term of terms) {
    for (const symbol of exports) {
      if (symbol === term) score += 200;
      else if (symbol.includes(term)) score += 12;
    }
    if (path.includes(term)) score += 6;
    if (imports.includes(term)) score += 2;
    if (summary.includes(term)) score += 1;
  }
  return score;
}

export function tokenize(value: string): string[] {
  const terms = value
    .toLowerCase()
    .split(/[^a-z0-9_.:/-]+/i)
    .map((term) => term.trim().replace(/^[._:/-]+|[._:/-]+$/g, ""))
    .filter((term) => term.length > 1 && !QUERY_STOP_WORDS.has(term));
  return [...new Set(terms)];
}

export function capText(text: string, maxTokens: number): string {
  const maxChars = Math.max(300, maxTokens * 4);
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 14).trimEnd()}\n[truncated]`;
}

export function isRepoMap(value: unknown): value is RepoMap {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === REPO_MAP_VERSION && typeof record.worktreeFingerprint === "string" && Array.isArray(record.files)
  );
}

function extractImports(text: string): string[] {
  const imports = new Set<string>();
  for (const match of text.matchAll(/import\s+(?:type\s+)?(?:[^"']+\s+from\s+)?["']([^"']+)["']/g)) {
    imports.add(match[1]);
  }
  for (const match of text.matchAll(/require\(["']([^"']+)["']\)/g)) {
    imports.add(match[1]);
  }
  return [...imports].sort();
}

function extractExports(text: string): SymbolRef[] {
  const result: SymbolRef[] = [];
  const patterns: Array<{ kind: SymbolRef["kind"]; regex: RegExp }> = [
    { kind: "function", regex: /export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g },
    { kind: "class", regex: /export\s+class\s+([A-Za-z0-9_$]+)/g },
    { kind: "interface", regex: /export\s+interface\s+([A-Za-z0-9_$]+)/g },
    { kind: "type", regex: /export\s+type\s+([A-Za-z0-9_$]+)/g },
    { kind: "const", regex: /export\s+const\s+([A-Za-z0-9_$]+)/g },
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern.regex)) {
      if (isInsideStringLiteralOnLine(text, match.index ?? 0)) continue;
      const line = findLine(text, match.index ?? 0);
      result.push({ name: match[1], kind: pattern.kind, signature: line.trim().slice(0, 180) });
    }
  }
  for (const match of text.matchAll(/export\s+\{([^}]+)\}/g)) {
    if (isInsideStringLiteralOnLine(text, match.index ?? 0)) continue;
    for (const name of match[1].split(",").map((part) =>
      part
        .trim()
        .split(/\s+as\s+/i)
        .at(-1)
        ?.trim(),
    )) {
      if (name) result.push({ name, kind: "export" });
    }
  }
  return dedupeSymbols(result).slice(0, 40);
}

function summarizeFile(text: string, path: string): string {
  if (path.endsWith(".md")) {
    const heading = text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("#"));
    return heading ? heading.replace(/^#+\s*/, "").slice(0, 160) : "Markdown document.";
  }
  const firstComment = text
    .match(/\/\*\*([\s\S]*?)\*\//)?.[1]
    ?.replace(/\s+/g, " ")
    .trim();
  if (firstComment) return firstComment.slice(0, 180);
  const exports = extractExports(text)
    .slice(0, 5)
    .map((symbol) => symbol.name);
  return exports.length > 0 ? `Exports ${exports.join(", ")}.` : "No exported symbols detected.";
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function findLine(text: string, index: number): string {
  const start = text.lastIndexOf("\n", index) + 1;
  const end = text.indexOf("\n", index);
  return text.slice(start, end === -1 ? text.length : end);
}

function isInsideStringLiteralOnLine(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf("\n", index) + 1;
  const prefix = text.slice(lineStart, index);
  return hasOddUnescapedQuote(prefix, '"') || hasOddUnescapedQuote(prefix, "'") || hasOddUnescapedQuote(prefix, "`");
}

function hasOddUnescapedQuote(text: string, quote: string): boolean {
  let count = 0;
  let escaped = false;
  for (const char of text) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === quote) count++;
  }
  return count % 2 === 1;
}

function dedupeSymbols(symbols: SymbolRef[]): SymbolRef[] {
  const seen = new Set<string>();
  const result: SymbolRef[] = [];
  for (const symbol of symbols) {
    const key = `${symbol.kind}:${symbol.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(symbol);
  }
  return result;
}

function languageForExtension(ext: string): string {
  switch (ext) {
    case ".ts":
    case ".tsx":
      return "typescript";
    case ".js":
    case ".jsx":
    case ".cjs":
      return "javascript";
    case ".json":
      return "json";
    case ".md":
      return "markdown";
    default:
      return ext.replace(/^\./, "") || "text";
  }
}
