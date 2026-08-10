import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { findWorkspaceRoot } from "../workspace-root.ts";
import { MAX_SEARCH_FILE_BYTES, MAX_SEARCH_RESULTS, PROJECT_MEMORY_DIR } from "./constants.ts";
import { stripManagedBlocks } from "./migration.ts";
import type { ProjectMemorySearchResult } from "./types.ts";

export function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_.:/-]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
}

export function listMemoryFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const result: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "state" || entry.name === "cache" || entry.name.startsWith(".")) continue;
      result.push(...listMemoryFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      result.push(path);
    }
  }
  return result;
}

export function scoreText(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (lower.includes(term)) score++;
  }
  return score / terms.length;
}

export function searchProjectMemory(cwd: string, query: string): ProjectMemorySearchResult {
  const terms = tokenize(query);
  if (terms.length === 0) return { query, hits: [] };
  const projectRoot = findWorkspaceRoot(cwd);
  const memoryRoot = join(projectRoot, PROJECT_MEMORY_DIR);
  if (!existsSync(memoryRoot)) return { query, hits: [] };

  const hits: ProjectMemorySearchResult["hits"] = [];
  const files = listMemoryFiles(memoryRoot);

  for (const file of files) {
    const stat = statSync(file);
    if (!stat.isFile() || stat.size > MAX_SEARCH_FILE_BYTES) continue;
    const text = stripManagedBlocks(readFileSync(file, "utf8"));
    const lines = text.split("\n");
    lines.forEach((line, index) => {
      const score = scoreText(line, terms);
      if (score <= 0) return;
      hits.push({
        path: relative(projectRoot, file),
        line: index + 1,
        excerpt: line.trim().slice(0, 240),
        score,
      });
    });
  }

  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.line - b.line);
  return { query, hits: hits.slice(0, MAX_SEARCH_RESULTS) };
}
