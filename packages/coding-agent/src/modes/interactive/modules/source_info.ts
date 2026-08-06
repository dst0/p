/**
 * Source info display helpers for the TUI.
 * Extracted from InteractiveMode.
 */

import type { SourceInfo } from "../../../core/source-info.ts";
import { theme } from "../theme/theme.ts";
import { formatDisplayPath, getCompactPackageSourceLabel, getShortPath } from "./path_helpers.ts";

/**
 * Display information for a source.
 */
export interface DisplaySourceInfo {
  label: string;
  scopeLabel?: string;
  color: "accent" | "muted";
}

/**
 * Get display source info for a SourceInfo.
 */
export function getDisplaySourceInfo(sourceInfo?: SourceInfo): DisplaySourceInfo {
  const source = sourceInfo?.source ?? "local";
  const scope = sourceInfo?.scope ?? "project";
  if (source === "local") {
    if (scope === "user") return { label: "user", color: "muted" };
    if (scope === "project") return { label: "project", color: "muted" };
    if (scope === "temporary") return { label: "path", scopeLabel: "temp", color: "muted" };
    return { label: "path", color: "muted" };
  }
  if (source === "cli") {
    return {
      label: "path",
      scopeLabel: scope === "temporary" ? "temp" : undefined,
      color: "muted",
    };
  }
  const scopeLabel =
    scope === "user" ? "user" : scope === "project" ? "project" : scope === "temporary" ? "temp" : undefined;
  return { label: source, scopeLabel, color: "accent" };
}

/**
 * Determine scope group for a source.
 */
export function getScopeGroup(sourceInfo?: SourceInfo): "user" | "project" | "path" {
  const source = sourceInfo?.source ?? "local";
  const scope = sourceInfo?.scope ?? "project";
  if (source === "cli" || scope === "temporary") return "path";
  if (scope === "user") return "user";
  if (scope === "project") return "project";
  return "path";
}

/**
 * Check if a source is a package source (npm or git).
 */
export function isPackageSource(sourceInfo?: SourceInfo): boolean {
  const source = sourceInfo?.source ?? "";
  return source.startsWith("npm:") || source.startsWith("git:");
}

/**
 * Scope group structure for organizing resources.
 */
export interface ScopeGroup {
  scope: "user" | "project" | "path";
  paths: Array<{ path: string; sourceInfo?: SourceInfo }>;
  packages: Map<string, Array<{ path: string; sourceInfo?: SourceInfo }>>;
}

/**
 * Build scope groups from items.
 */
export function buildScopeGroups(items: Array<{ path: string; sourceInfo?: SourceInfo }>): ScopeGroup[] {
  const groups: Record<"user" | "project" | "path", ScopeGroup> = {
    user: { scope: "user", paths: [], packages: new Map() },
    project: { scope: "project", paths: [], packages: new Map() },
    path: { scope: "path", paths: [], packages: new Map() },
  };

  for (const item of items) {
    const groupKey = getScopeGroup(item.sourceInfo);
    const group = groups[groupKey];

    if (isPackageSource(item.sourceInfo)) {
      const source = item.sourceInfo?.source ?? "local";
      const list = group.packages.get(source) ?? [];
      list.push(item);
      group.packages.set(source, list);
    } else {
      group.paths.push(item);
    }
  }

  return [groups.project, groups.user, groups.path].filter(
    (group) => group.paths.length > 0 || group.packages.size > 0,
  );
}

export function formatScopeGroups(
  groups: ScopeGroup[],
  options: {
    formatPath: (item: { path: string; sourceInfo?: SourceInfo }) => string;
    formatPackagePath: (item: { path: string; sourceInfo?: SourceInfo }, source: string) => string;
  },
): string {
  const lines: string[] = [];

  for (const group of groups) {
    lines.push(theme.fg("accent", `  ${group.scope}`));

    for (const item of group.paths) {
      lines.push(theme.fg("dim", `    ${options.formatPath(item)}`));
    }

    for (const [source, packageList] of group.packages) {
      const label = getCompactPackageSourceLabel({ source } as SourceInfo);
      lines.push(theme.fg("accent", `    @${label}`));
      for (const item of packageList) {
        lines.push(theme.fg("dim", `      ${options.formatPackagePath(item, source)}`));
      }
    }
  }

  return lines.join("\n");
}

/**
 * Find source info for a path by walking up parent directories.
 */
export function findSourceInfoForPath(p: string, sourceInfos: Map<string, SourceInfo>): SourceInfo | undefined {
  const exact = sourceInfos.get(p);
  if (exact) return exact;

  let current = p;
  while (current.includes("/")) {
    current = current.substring(0, current.lastIndexOf("/"));
    const parent = sourceInfos.get(current);
    if (parent) return parent;
  }

  return undefined;
}

/**
 * Format a path with its source info label.
 */
export function formatPathWithSource(p: string, sourceInfo?: SourceInfo): string {
  if (sourceInfo) {
    const shortPath = getShortPath(p, sourceInfo);
    const { label, scopeLabel } = getDisplaySourceInfo(sourceInfo);
    const labelText = scopeLabel ? `${label} (${scopeLabel})` : label;
    return `${labelText} ${shortPath}`;
  }
  return formatDisplayPath(p);
}
