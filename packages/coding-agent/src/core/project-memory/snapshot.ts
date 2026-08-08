import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderPlanStatusMarker } from "../compaction/index.ts";
import {
  MEMORY_FILE_TEMPLATES,
  PROJECT_MEMORY_DIR,
  PROJECT_MEMORY_ROOT,
  PROJECT_MEMORY_STATE_FILE,
  PROJECT_SESSIONS_DIR,
  PROJECT_STATE_DIR,
  PROJECT_TRACES_DIR,
  SNAPSHOT_VERSION,
} from "./constants.ts";
import type {
  ProjectMemoryInitResult,
  ProjectMemorySnapshot,
  ProjectMemoryUpdateInput,
  ProjectMemoryUpdateResult,
} from "./types.ts";

export function initProjectMemory(cwd: string): ProjectMemoryInitResult {
  const created: string[] = [];
  const existing: string[] = [];
  for (const dir of [PROJECT_MEMORY_DIR, PROJECT_STATE_DIR, PROJECT_SESSIONS_DIR, PROJECT_TRACES_DIR]) {
    const absoluteDir = join(cwd, dir);
    if (existsSync(absoluteDir)) {
      existing.push(dir);
    } else {
      mkdirSync(absoluteDir, { recursive: true });
      created.push(dir);
    }
  }

  for (const template of MEMORY_FILE_TEMPLATES) {
    const relativePath = join(PROJECT_MEMORY_DIR, template.path);
    const absolutePath = join(cwd, relativePath);
    if (existsSync(absolutePath)) {
      existing.push(relativePath);
      continue;
    }
    writeFileSync(absolutePath, template.body);
    created.push(relativePath);
  }

  return { root: join(cwd, PROJECT_MEMORY_ROOT), created, existing };
}

export function createSnapshot(input: ProjectMemoryUpdateInput): ProjectMemorySnapshot {
  const contextUsage = input.contextUsage
    ? {
        tokens: input.contextUsage.tokens,
        contextWindow: input.contextUsage.contextWindow,
        triggerThreshold: input.contextUsage.triggerThreshold,
        targetContextTokens: input.contextUsage.targetContextTokens,
        shouldCompact: input.contextUsage.shouldCompact,
        toolRawTokens: input.contextUsage.toolRawTokens ?? 0,
      }
    : undefined;
  return {
    version: SNAPSHOT_VERSION,
    updatedAt: new Date().toISOString(),
    sessionId: input.sessionId,
    checkpoint: input.checkpoint,
    state: input.state,
    contextUsage,
  };
}

export function renderManagedBlock(id: string, lines: string[]): string {
  return [`<!-- p:${id}:begin -->`, ...lines, `<!-- p:${id}:end -->`].join("\n");
}

export function capLine(text: string, maxChars: number): string {
  const compacted = text.replace(/\s+/g, " ").trim();
  if (compacted.length <= maxChars) return compacted;
  // Reserve 3 chars for the '...' suffix so the total never exceeds maxChars.
  const prefixMax = Math.max(0, maxChars - 3);
  const prefix = compacted.slice(0, Math.max(20, prefixMax));
  const wordBreak = prefix.lastIndexOf(" ");
  const rawCutAt = wordBreak > Math.floor(maxChars * 0.4) ? wordBreak : Math.min(prefix.length, prefixMax);
  // Clamp to prefixMax in case wordBreak exceeds it (small maxChars edge case).
  const cutAt = Math.min(rawCutAt, prefixMax);
  return `${prefix.slice(0, cutAt).trimEnd()}...`;
}

export function capText(text: string, maxTokens: number): string {
  const maxChars = Math.max(200, maxTokens * 4);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 14).trimEnd()}\n[truncated]`;
}

export function renderBulletList(items: string[]): string[] {
  return items.length > 0 ? items.map((item) => `- ${item}`) : ["- (none)"];
}

export function replaceManagedBlock(content: string, block: string): string {
  const firstLine = block.slice(0, block.indexOf("\n"));
  const lastLine = block.slice(block.lastIndexOf("\n") + 1);
  const start = content.indexOf(firstLine);
  const end = content.indexOf(lastLine);
  if (start !== -1 && end !== -1 && end >= start) {
    return `${content.slice(0, start)}${block}${content.slice(end + lastLine.length)}`;
  }
  const separator = content.trim().length > 0 ? "\n\n" : "";
  return `${content.trimEnd()}${separator}${block}\n`;
}

export function updateManagedMemoryFiles(cwd: string, snapshot: ProjectMemorySnapshot): string[] {
  const changed: string[] = [];
  const updates: Array<{ relativePath: string; body: string }> = [
    {
      relativePath: join(PROJECT_MEMORY_DIR, "active-context.md"),
      body: renderManagedBlock("auto-active-context", [
        `Updated: ${snapshot.updatedAt}`,
        `Session: ${snapshot.sessionId}`,
        `Goal: ${capLine(snapshot.state?.canonicalRequest.current || "(unknown)", 360)}`,
        "",
        "Checkpoint:",
        capText(snapshot.checkpoint, 900),
      ]),
    },
    {
      relativePath: join(PROJECT_MEMORY_DIR, "progress.md"),
      body: renderManagedBlock("auto-progress", [
        `Updated: ${snapshot.updatedAt}`,
        "",
        "Plan:",
        ...renderBulletList(
          snapshot.state?.plan.map((item) => `${renderPlanStatusMarker(item.status)} ${item.text}`) ?? [],
        ),
      ]),
    },
    {
      relativePath: join(PROJECT_MEMORY_DIR, "decisions.md"),
      body: renderManagedBlock("auto-decisions", [
        `Updated: ${snapshot.updatedAt}`,
        "",
        ...renderBulletList(
          (snapshot.state?.decisions ?? [])
            .filter((decision) => decision.status === "active")
            .map((decision) => `${decision.decision}${decision.rationale ? ` - ${decision.rationale}` : ""}`),
        ),
      ]),
    },
    {
      relativePath: join(PROJECT_MEMORY_DIR, "commands.md"),
      body: renderManagedBlock("auto-context-budget", [
        `Updated: ${snapshot.updatedAt}`,
        `Context tokens: ${snapshot.contextUsage?.tokens ?? "(unknown)"}/${snapshot.contextUsage?.contextWindow ?? "(unknown)"}`,
        `Trigger threshold: ${snapshot.contextUsage?.triggerThreshold ?? "(unknown)"}`,
      ]),
    },
  ];

  for (const update of updates) {
    const path = join(cwd, update.relativePath);
    const before = existsSync(path) ? readFileSync(path, "utf8") : "";
    const after = replaceManagedBlock(before, update.body);
    if (before !== after) {
      writeFileSync(path, after);
      changed.push(update.relativePath);
    }
  }

  return changed;
}

export function updateProjectMemorySnapshot(input: ProjectMemoryUpdateInput): ProjectMemoryUpdateResult {
  initProjectMemory(input.cwd);
  const path = join(input.cwd, PROJECT_MEMORY_STATE_FILE);
  const created = !existsSync(path);
  const snapshot = createSnapshot(input);
  writeFileSync(path, `${JSON.stringify(snapshot, undefined, 2)}\n`);
  const managedFiles = updateManagedMemoryFiles(input.cwd, snapshot);
  return { path, created, managedFiles };
}
