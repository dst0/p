import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { StructuredSessionState } from "../compaction/index.ts";
import {
  MAX_SEARCH_FILE_BYTES,
  MAX_SEARCH_RESULTS,
  PROJECT_MEMORY_DIR,
  PROJECT_MEMORY_STATE_FILE,
  PROJECT_STATE_DIR,
  SNAPSHOT_VERSION,
} from "./constants.ts";
import { createSnapshot } from "./helpers-part1.ts";
import type {
  ProjectMemoryDiffInput,
  ProjectMemoryDiffResult,
  ProjectMemorySearchResult,
  ProjectMemorySnapshot,
} from "./types.ts";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isProjectMemorySnapshot(value: unknown): value is ProjectMemorySnapshot {
  if (!isRecord(value)) return false;
  return (
    value.version === SNAPSHOT_VERSION && typeof value.updatedAt === "string" && typeof value.sessionId === "string"
  );
}

export function readProjectMemorySnapshot(cwd: string): ProjectMemorySnapshot | undefined {
  const path = join(cwd, PROJECT_MEMORY_STATE_FILE);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return isProjectMemorySnapshot(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function formatDiffValue(value: unknown): string {
  if (typeof value === "string") {
    return value.length > 120 ? `${value.slice(0, 117)}...` : value || "(empty)";
  }
  if (value === undefined) return "(missing)";
  return JSON.stringify(value);
}

export function pushDiff(lines: string[], label: string, before: unknown, after: unknown): void {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  lines.push(`${label}: ${formatDiffValue(before)} -> ${formatDiffValue(after)}`);
}

export function countActiveConstraints(state: StructuredSessionState | undefined): number {
  return state?.constraints.filter((constraint) => constraint.status === "active").length ?? 0;
}

export function planSignature(state: StructuredSessionState | undefined): string {
  return state?.plan.map((item) => `${item.id}:${item.status}`).join(",") ?? "";
}

export function fileSignature(state: StructuredSessionState | undefined): string {
  return state?.codebase.touchedFiles.map((file) => `${file.path}:${file.status}`).join(",") ?? "";
}

export function compareSnapshots(previous: ProjectMemorySnapshot, current: ProjectMemorySnapshot): string[] {
  const lines: string[] = [];
  pushDiff(lines, "session", previous.sessionId, current.sessionId);
  pushDiff(lines, "goal", previous.state?.canonicalRequest.current, current.state?.canonicalRequest.current);
  pushDiff(lines, "checkpoint", previous.checkpoint, current.checkpoint);
  pushDiff(lines, "context tokens", previous.contextUsage?.tokens, current.contextUsage?.tokens);
  pushDiff(lines, "active constraints", countActiveConstraints(previous.state), countActiveConstraints(current.state));
  pushDiff(lines, "plan signature", planSignature(previous.state), planSignature(current.state));
  pushDiff(lines, "touched files", fileSignature(previous.state), fileSignature(current.state));
  pushDiff(lines, "evidence pointers", previous.state?.evidence.length, current.state?.evidence.length);
  return lines;
}

export function diffProjectMemorySnapshot(input: ProjectMemoryDiffInput): ProjectMemoryDiffResult {
  const path = join(input.cwd, PROJECT_MEMORY_STATE_FILE);
  const previous = readProjectMemorySnapshot(input.cwd);
  if (!previous) {
    return {
      status: "missing",
      path,
      lines: [`No saved project memory snapshot at ${path}. Run /memory update first.`],
    };
  }

  const current = createSnapshot(input);
  const lines = compareSnapshots(previous, current);
  return {
    status: lines.length === 0 ? "same" : "changed",
    path,
    lines: lines.length === 0 ? ["Saved project memory snapshot matches current session state."] : lines,
  };
}

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
      result.push(...listMemoryFiles(path));
    } else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".json"))) {
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
  const roots = [join(cwd, PROJECT_MEMORY_DIR), join(cwd, PROJECT_STATE_DIR)].filter((root) => existsSync(root));
  const hits: ProjectMemorySearchResult["hits"] = [];
  for (const file of roots.flatMap((root) => listMemoryFiles(root))) {
    const stat = statSync(file);
    if (!stat.isFile() || stat.size > MAX_SEARCH_FILE_BYTES) continue;
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n");
    lines.forEach((line, index) => {
      const score = scoreText(line, terms);
      if (score <= 0) return;
      hits.push({
        path: relative(cwd, file),
        line: index + 1,
        excerpt: line.trim().slice(0, 240),
        score,
      });
    });
  }
  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.line - b.line);
  return { query, hits: hits.slice(0, MAX_SEARCH_RESULTS) };
}
