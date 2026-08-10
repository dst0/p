import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findWorkspaceRoot } from "../workspace-root.ts";
import { MEMORY_FILE_TEMPLATES, PROJECT_MEMORY_DIR, PROJECT_MEMORY_ROOT } from "./constants.ts";
import { migrateProjectMemory } from "./migration.ts";
import type { ProjectMemoryInitResult } from "./types.ts";

export function initProjectMemory(cwd: string): ProjectMemoryInitResult {
  const projectRoot = findWorkspaceRoot(cwd);
  const created: string[] = [];
  const existing: string[] = [];

  const memoryDir = join(projectRoot, PROJECT_MEMORY_DIR);
  if (existsSync(memoryDir)) {
    existing.push(PROJECT_MEMORY_DIR);
  } else {
    mkdirSync(memoryDir, { recursive: true });
    created.push(PROJECT_MEMORY_DIR);
  }

  for (const template of MEMORY_FILE_TEMPLATES) {
    const relativePath = join(PROJECT_MEMORY_DIR, template.path);
    const absolutePath = join(projectRoot, relativePath);
    if (existsSync(absolutePath)) {
      existing.push(relativePath);
    } else {
      writeFileSync(absolutePath, template.body, "utf8");
      created.push(relativePath);
    }
  }

  migrateProjectMemory(projectRoot);

  return { root: join(projectRoot, PROJECT_MEMORY_ROOT), created, existing };
}

export function capText(text: string, maxTokens: number): string {
  const maxChars = Math.max(200, maxTokens * 4);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 14).trimEnd()}\n[truncated]`;
}
