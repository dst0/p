import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { PROJECT_MEMORY_DIR, PROJECT_MEMORY_STATE_FILE } from "./constants.ts";
import {
  listMemoryFiles,
  readProjectMemorySnapshot,
  scoreText,
  searchProjectMemory,
  tokenize,
} from "./diff-formatting.ts";
import { capText, initProjectMemory } from "./snapshot.ts";
import type { ProjectMemoryContextResult, ProjectMemoryForgetResult, ProjectMemoryPinResult } from "./types.ts";

export function createProjectMemoryContext(
  cwd: string,
  query: string,
  maxTokens = 800,
): ProjectMemoryContextResult | undefined {
  const search = searchProjectMemory(cwd, query);
  const snapshot = readProjectMemorySnapshot(cwd);
  const terms = tokenize(query);
  const lines: string[] = [];
  const checkpointRelevant =
    snapshot?.checkpoint && (search.hits.length > 0 || terms.length === 0 || scoreText(snapshot.checkpoint, terms) > 0);
  if (checkpointRelevant) {
    lines.push("Current project/session checkpoint:");
    lines.push(capText(snapshot.checkpoint, Math.min(maxTokens, 500)));
  }
  if (search.hits.length > 0) {
    lines.push("Relevant project memory snippets:");
    for (const hit of search.hits.slice(0, 5)) {
      lines.push(`- ${hit.path}:${hit.line}: ${hit.excerpt}`);
    }
  }
  if (lines.length === 0) return undefined;

  return {
    query,
    content: capText(
      [
        "<project_memory>",
        "Automatically selected durable project memory. Treat it as context, not as a replacement for current user instructions.",
        ...lines,
        "</project_memory>",
      ].join("\n"),
      maxTokens,
    ),
    hits: search.hits,
  };
}

export function pinProjectMemory(cwd: string, text: string): ProjectMemoryPinResult {
  initProjectMemory(cwd);
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Usage: /memory pin <text>");
  }
  const id = `pin-${Date.now().toString(36)}`;
  const path = join(cwd, PROJECT_MEMORY_DIR, "gotchas.md");
  const line = `\n<!-- memory-id:${id} -->\n- [${id}] ${new Date().toISOString()}: ${trimmed}\n`;
  appendFileSync(path, line);
  return { id, path };
}

export function forgetProjectMemory(cwd: string, id: string): ProjectMemoryForgetResult {
  const trimmed = id.trim();
  if (!trimmed) {
    throw new Error("Usage: /memory forget <memory-id>");
  }
  const files = listMemoryFiles(join(cwd, PROJECT_MEMORY_DIR));
  let removed = 0;
  const changedFiles: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n");
    const kept = lines.filter((line) => {
      const matches = line.includes(`memory-id:${trimmed}`) || line.includes(`[${trimmed}]`);
      if (matches) removed++;
      return !matches;
    });
    if (kept.length !== lines.length) {
      writeFileSync(file, kept.join("\n"));
      changedFiles.push(relative(cwd, file));
    }
  }

  const snapshotPath = join(cwd, PROJECT_MEMORY_STATE_FILE);
  if (existsSync(snapshotPath) && trimmed === "session.current") {
    unlinkSync(snapshotPath);
    removed++;
    changedFiles.push(PROJECT_MEMORY_STATE_FILE);
  }

  return { id: trimmed, removed, files: changedFiles };
}
