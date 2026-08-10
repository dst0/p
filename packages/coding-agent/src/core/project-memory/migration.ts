import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { findWorkspaceRoot } from "../workspace-root.ts";
import { PROJECT_MEMORY_DIR } from "./constants.ts";

export const MANAGED_BLOCK_IDS = [
  "auto-active-context",
  "auto-progress",
  "auto-decisions",
  "auto-context-budget",
] as const;

export function stripManagedBlocks(content: string): string {
  let result = content;
  for (const id of MANAGED_BLOCK_IDS) {
    const beginTag = `<!-- p:${id}:begin -->`;
    const endTag = `<!-- p:${id}:end -->`;
    while (true) {
      const start = result.indexOf(beginTag);
      if (start === -1) break;
      const end = result.indexOf(endTag, start);
      if (end === -1) break;

      let blockStart = start;
      let blockEnd = end + endTag.length;

      if (blockEnd < result.length && result[blockEnd] === "\n") {
        blockEnd++;
      } else if (blockStart > 0 && result[blockStart - 1] === "\n") {
        blockStart--;
      }

      result = result.slice(0, blockStart) + result.slice(blockEnd);
    }
  }
  return result;
}

export function atomicWriteFileSync(filePath: string, content: string): void {
  const dir = dirname(filePath);
  const tempPath = join(dir, `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(tempPath, content, "utf8");
    renameSync(tempPath, filePath);
  } catch (error) {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // Preserve the original write or rename error.
    }
    throw error;
  }
}

export function migrateProjectMemory(cwd: string): string[] {
  const projectRoot = findWorkspaceRoot(cwd);
  const dir = join(projectRoot, PROJECT_MEMORY_DIR);
  if (!existsSync(dir)) return [];

  const migrated: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      const fullPath = join(dir, entry.name);
      const original = readFileSync(fullPath, "utf8");
      const stripped = stripManagedBlocks(original);
      if (original !== stripped) {
        atomicWriteFileSync(fullPath, stripped);
        migrated.push(relative(projectRoot, fullPath));
      }
    }
  }

  return migrated;
}
