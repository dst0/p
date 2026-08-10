import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getGitSha, getWorktreeFingerprint } from "./repo-map-fingerprint.ts";
import { capText, indexFile, isRepoMap, listIndexableFiles, scoreFile, tokenize } from "./repo-map-helpers.ts";
import { findWorkspaceRoot } from "./workspace-root.ts";

const REPO_MAP_VERSION = 1;
const REPO_MAP_FILE = ".pdev/cache/repo-map.json";
const MAX_CONTEXT_TOKENS = 900;

export interface SymbolRef {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "const" | "export";
  signature?: string;
}

export interface RepoMapFile {
  path: string;
  language: string;
  imports: string[];
  exports: SymbolRef[];
  summary: string;
  lastIndexedSha: string;
}

export interface RepoMap {
  version: number;
  root: string;
  indexedAt: string;
  lastIndexedSha: string;
  worktreeFingerprint: string;
  files: RepoMapFile[];
}

export interface RepoMapContext {
  query: string;
  content: string;
  files: RepoMapFile[];
}

export function buildRepoMap(root: string): RepoMap {
  const canonicalRoot = findWorkspaceRoot(root);
  const sha = getGitSha(canonicalRoot);
  const worktreeFingerprint = getWorktreeFingerprint(canonicalRoot);
  const files = listIndexableFiles(canonicalRoot).map((path) => indexFile(canonicalRoot, path, sha));
  return {
    version: REPO_MAP_VERSION,
    root: canonicalRoot,
    indexedAt: new Date().toISOString(),
    lastIndexedSha: sha,
    worktreeFingerprint,
    files,
  };
}

export function updateRepoMap(root: string): RepoMap {
  const canonicalRoot = findWorkspaceRoot(root);
  const map = buildRepoMap(canonicalRoot);
  const filePath = join(canonicalRoot, REPO_MAP_FILE);
  mkdirSync(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(map, undefined, 2)}\n`);
    renameSync(temporaryPath, filePath);
  } catch (error) {
    try {
      if (existsSync(temporaryPath)) {
        rmSync(temporaryPath, { force: true });
      }
    } catch {
      // Ignore secondary cleanup error to retain primary error
    }
    throw error;
  }
  return map;
}

export function readRepoMap(root: string): RepoMap | undefined {
  const canonicalRoot = findWorkspaceRoot(root);
  const filePath = join(canonicalRoot, REPO_MAP_FILE);
  if (!existsSync(filePath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    return isRepoMap(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function getOrUpdateRepoMap(root: string): RepoMap {
  const canonicalRoot = findWorkspaceRoot(root);
  const existing = readRepoMap(canonicalRoot);
  const sha = getGitSha(canonicalRoot);
  const worktreeFingerprint = getWorktreeFingerprint(canonicalRoot);
  if (existing?.lastIndexedSha === sha && existing.worktreeFingerprint === worktreeFingerprint) {
    return existing;
  }
  return updateRepoMap(canonicalRoot);
}

export function createRepoMapContext(
  root: string,
  query: string,
  maxTokens = MAX_CONTEXT_TOKENS,
): RepoMapContext | undefined {
  const map = getOrUpdateRepoMap(root);
  const terms = tokenize(query);
  if (terms.length === 0) return undefined;
  const scored = map.files
    .map((file) => ({ file, score: scoreFile(file, terms) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path))
    .slice(0, 8);
  if (scored.length === 0) return undefined;
  const lines = [
    "<repo_map>",
    "Automatically selected repo-map snippets. Read exact files before editing.",
    ...scored.map(({ file }) => {
      const exports =
        file.exports
          .slice(0, 8)
          .map((symbol) => symbol.name)
          .join(", ") || "(none)";
      const imports = file.imports.slice(0, 6).join(", ") || "(none)";
      return `- ${file.path} [${file.language}] exports: ${exports}; imports: ${imports}; ${file.summary}`;
    }),
    "</repo_map>",
  ];
  return {
    query,
    content: capText(lines.join("\n"), maxTokens),
    files: scored.map((item) => item.file),
  };
}
