import type { ResourceDiagnostic } from "../../../../core/resource-loader.ts";
import type { SourceInfo } from "../../../../core/source-info.ts";
import { theme } from "../../theme/theme.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export function do_formatScopeGroups(
  _self: InteractiveMode,
  groups: Array<{
    scope: "user" | "project" | "path";
    paths: Array<{ path: string; sourceInfo?: SourceInfo }>;
    packages: Map<string, Array<{ path: string; sourceInfo?: SourceInfo }>>;
  }>,
  options: {
    formatPath: (item: { path: string; sourceInfo?: SourceInfo }) => string;
    formatPackagePath: (item: { path: string; sourceInfo?: SourceInfo }, source: string) => string;
  },
): string {
  const lines: string[] = [];

  for (const group of groups) {
    lines.push(`  ${theme.fg("accent", group.scope)}`);

    const sortedPaths = [...group.paths].sort((a, b) => a.path.localeCompare(b.path));
    for (const item of sortedPaths) {
      lines.push(theme.fg("dim", `    ${options.formatPath(item)}`));
    }

    const sortedPackages = Array.from(group.packages.entries()).sort(([a], [b]) => a.localeCompare(b));
    for (const [source, items] of sortedPackages) {
      lines.push(`    ${theme.fg("mdLink", source)}`);
      const sortedPackagePaths = [...items].sort((a, b) => a.path.localeCompare(b.path));
      for (const item of sortedPackagePaths) {
        lines.push(theme.fg("dim", `      ${options.formatPackagePath(item, source)}`));
      }
    }
  }

  return lines.join("\n");
}

export function do_findSourceInfoForPath(
  _self: InteractiveMode,
  p: string,
  sourceInfos: Map<string, SourceInfo>,
): SourceInfo | undefined {
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

export function do_formatPathWithSource(self: InteractiveMode, p: string, sourceInfo?: SourceInfo): string {
  if (sourceInfo) {
    const shortPath = self.getShortPath(p, sourceInfo);
    const { label, scopeLabel } = self.getDisplaySourceInfo(sourceInfo);
    const labelText = scopeLabel ? `${label} (${scopeLabel})` : label;
    return `${labelText} ${shortPath}`;
  }
  return self.formatDisplayPath(p);
}

export function do_formatDiagnostics(
  self: InteractiveMode,
  diagnostics: readonly ResourceDiagnostic[],
  sourceInfos: Map<string, SourceInfo>,
): string {
  const lines: string[] = [];

  // Group collision diagnostics by name
  const collisions = new Map<string, ResourceDiagnostic[]>();
  const otherDiagnostics: ResourceDiagnostic[] = [];

  for (const d of diagnostics) {
    if (d.type === "collision" && d.collision) {
      const list = collisions.get(d.collision.name) ?? [];
      list.push(d);
      collisions.set(d.collision.name, list);
    } else {
      otherDiagnostics.push(d);
    }
  }

  // Format collision diagnostics grouped by name
  for (const [name, collisionList] of collisions) {
    const first = collisionList[0]?.collision;
    if (!first) continue;
    lines.push(theme.fg("warning", `  "${name}" collision:`));
    lines.push(
      theme.fg(
        "dim",
        `    ${theme.fg("success", "✓")} ${self.formatPathWithSource(first.winnerPath, self.findSourceInfoForPath(first.winnerPath, sourceInfos))}`,
      ),
    );
    for (const d of collisionList) {
      if (d.collision) {
        lines.push(
          theme.fg(
            "dim",
            `    ${theme.fg("warning", "✗")} ${self.formatPathWithSource(d.collision.loserPath, self.findSourceInfoForPath(d.collision.loserPath, sourceInfos))} (skipped)`,
          ),
        );
      }
    }
  }

  for (const d of otherDiagnostics) {
    if (d.path) {
      const formattedPath = self.formatPathWithSource(d.path, self.findSourceInfoForPath(d.path, sourceInfos));
      lines.push(theme.fg(d.type === "error" ? "error" : "warning", `  ${formattedPath}`));
      lines.push(theme.fg(d.type === "error" ? "error" : "warning", `    ${d.message}`));
    } else {
      lines.push(theme.fg(d.type === "error" ? "error" : "warning", `  ${d.message}`));
    }
  }

  return lines.join("\n");
}
