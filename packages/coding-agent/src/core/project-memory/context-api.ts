import { appendFileSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { findWorkspaceRoot } from "../workspace-root.ts";
import { PROJECT_MEMORY_DIR } from "./constants.ts";
import { capText, initProjectMemory } from "./init.ts";
import { atomicWriteFileSync } from "./migration.ts";
import { listMemoryFiles, searchProjectMemory } from "./search.ts";
import type { ProjectMemoryContextResult, ProjectMemoryForgetResult, ProjectMemoryPinResult } from "./types.ts";

export function createProjectMemoryContext(
  cwd: string,
  query: string,
  maxTokens = 800,
): ProjectMemoryContextResult | undefined {
  const search = searchProjectMemory(cwd, query);
  if (search.hits.length === 0) return undefined;

  const lines: string[] = ["Relevant project memory snippets:"];
  for (const hit of search.hits.slice(0, 5)) {
    lines.push(`- ${hit.path}:${hit.line}: ${hit.excerpt}`);
  }

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
  const projectRoot = findWorkspaceRoot(cwd);
  initProjectMemory(projectRoot);
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Usage: /memory pin <text>");
  }
  const id = `pin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const path = join(projectRoot, PROJECT_MEMORY_DIR, "gotchas.md");
  const line = `\n<!-- memory-id:${id} -->\n- [${id}] ${new Date().toISOString()}: ${trimmed}\n`;
  appendFileSync(path, line);
  return { id, path };
}

export function forgetProjectMemory(cwd: string, id: string): ProjectMemoryForgetResult {
  const projectRoot = findWorkspaceRoot(cwd);
  const trimmed = id.trim();
  if (!trimmed) {
    throw new Error("Usage: /memory forget <memory-id>");
  }
  const files = listMemoryFiles(join(projectRoot, PROJECT_MEMORY_DIR));
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
      atomicWriteFileSync(file, kept.join("\n"));
      changedFiles.push(relative(projectRoot, file));
    }
  }

  return { id: trimmed, removed, files: changedFiles };
}
