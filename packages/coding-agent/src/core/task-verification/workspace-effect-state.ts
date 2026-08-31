import { posix } from "node:path";

export const MAX_TASK_OWNED_PATHS = 128;

export interface TaskOwnedPathBaseline {
  path: string;
  state: string | null;
}

export const WORKSPACE_EFFECT_SKIPPED_SEGMENTS: readonly string[] = Object.freeze([
  ".git",
  ".pdev",
  ".p",
  ".pi",
  ".pnpm-store",
  "coverage",
  "dist",
  "node_modules",
  "target",
]);
const SKIPPED_SEGMENTS = new Set(WORKSPACE_EFFECT_SKIPPED_SEGMENTS);

export function normalizeWorkspaceEffectPath(value: unknown): string | undefined {
  const normalized = normalizeWorkspaceEffectSyntax(value);
  if (!normalized || isSkippedWorkspaceEffectPath(normalized)) return undefined;
  return normalized;
}

export function isSkippedWorkspaceEffectPath(value: unknown): boolean {
  const normalized = normalizeWorkspaceEffectSyntax(value);
  return normalized?.split("/").some((segment) => SKIPPED_SEGMENTS.has(segment)) ?? false;
}

function normalizeWorkspaceEffectSyntax(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 500) return undefined;
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value) || value.includes("\\")) return undefined;
  if (/[\u0000-\u001f\u007f]/u.test(value)) return undefined;
  const normalized = posix.normalize(value.replace(/^\.\//u, ""));
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) return undefined;
  return normalized;
}

export function isTaskOwnedPaths(value: unknown): value is string[] | undefined {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > MAX_TASK_OWNED_PATHS || new Set(value).size !== value.length)
    return false;
  return value.every((filePath) => normalizeWorkspaceEffectPath(filePath) === filePath);
}

export function isTaskOwnedPathBaselines(value: unknown): value is TaskOwnedPathBaseline[] | undefined {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > MAX_TASK_OWNED_PATHS) return false;
  const paths = new Set<string>();
  return value.every((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
    const baseline = entry as Record<string, unknown>;
    const filePath = normalizeWorkspaceEffectPath(baseline.path);
    if (!filePath || paths.has(filePath)) return false;
    if (baseline.state !== null && (typeof baseline.state !== "string" || baseline.state.length > 200)) return false;
    paths.add(filePath);
    return true;
  });
}

export function normalizedFilesChanged(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value.map(normalizeWorkspaceEffectPath);
  if (normalized.some((filePath) => filePath === undefined)) return undefined;
  return [...new Set(normalized as string[])].sort();
}
