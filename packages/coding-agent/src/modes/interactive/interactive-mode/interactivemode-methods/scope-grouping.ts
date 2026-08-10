import type { SourceInfo } from "../../../../core/source-info.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export function do_getCompactDisplayPathSegments(self: InteractiveMode, resourcePath: string): string[] {
  return self
    .formatDisplayPath(resourcePath)
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== "~");
}

export function do_getCompactNonPackageExtensionLabel(
  self: InteractiveMode,
  resourcePath: string,
  index: number,
  allPaths: Array<{ path: string; segments: string[] }>,
): string {
  const segments = allPaths[index]?.segments;
  if (!segments || segments.length === 0) {
    return self.getCompactPathLabel(resourcePath);
  }

  for (let segmentCount = 1; segmentCount <= segments.length; segmentCount += 1) {
    const candidate = segments.slice(-segmentCount).join("/");
    const isUnique = allPaths.every((item, itemIndex) => {
      if (itemIndex === index) {
        return true;
      }
      return item.segments.slice(-segmentCount).join("/") !== candidate;
    });

    if (isUnique) {
      return candidate;
    }
  }

  return segments.join("/");
}

export function do_getCompactExtensionLabels(
  self: InteractiveMode,
  extensions: Array<{ path: string; sourceInfo?: SourceInfo }>,
): string[] {
  const nonPackageExtensions = extensions
    .map((extension) => {
      const segments = self.getCompactDisplayPathSegments(extension.path);
      const lastSegment = segments[segments.length - 1];
      if (segments.length > 1 && (lastSegment === "index.ts" || lastSegment === "index.js")) {
        segments.pop();
      }
      return {
        path: extension.path,
        sourceInfo: extension.sourceInfo,
        segments,
      };
    })
    .filter((extension) => !self.isPackageSource(extension.sourceInfo));

  return extensions.map((extension) => {
    if (self.isPackageSource(extension.sourceInfo)) {
      return self.getCompactExtensionLabel(extension.path, extension.sourceInfo);
    }

    const nonPackageIndex = nonPackageExtensions.findIndex((item) => item.path === extension.path);
    if (nonPackageIndex === -1) {
      return self.getCompactPathLabel(extension.path, extension.sourceInfo);
    }

    return self.getCompactNonPackageExtensionLabel(extension.path, nonPackageIndex, nonPackageExtensions);
  });
}

export function do_getDisplaySourceInfo(
  _self: InteractiveMode,
  sourceInfo?: SourceInfo,
): {
  label: string;
  scopeLabel?: string;
  color: "accent" | "muted";
} {
  const source = sourceInfo?.source ?? "local";
  const scope = sourceInfo?.scope ?? "project";
  if (source === "local") {
    if (scope === "user") {
      return { label: "user", color: "muted" };
    }
    if (scope === "project") {
      return { label: "project", color: "muted" };
    }
    if (scope === "temporary") {
      return { label: "path", scopeLabel: "temp", color: "muted" };
    }
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

export function do_getScopeGroup(_self: InteractiveMode, sourceInfo?: SourceInfo): "user" | "project" | "path" {
  const source = sourceInfo?.source ?? "local";
  const scope = sourceInfo?.scope ?? "project";
  if (source === "cli" || scope === "temporary") return "path";
  if (scope === "user") return "user";
  if (scope === "project") return "project";
  return "path";
}

export function do_isPackageSource(_self: InteractiveMode, sourceInfo?: SourceInfo): boolean {
  const source = sourceInfo?.source ?? "";
  return source.startsWith("npm:") || source.startsWith("git:");
}

export function do_buildScopeGroups(
  self: InteractiveMode,
  items: Array<{ path: string; sourceInfo?: SourceInfo }>,
): Array<{
  scope: "user" | "project" | "path";
  paths: Array<{ path: string; sourceInfo?: SourceInfo }>;
  packages: Map<string, Array<{ path: string; sourceInfo?: SourceInfo }>>;
}> {
  const groups: Record<
    "user" | "project" | "path",
    {
      scope: "user" | "project" | "path";
      paths: Array<{ path: string; sourceInfo?: SourceInfo }>;
      packages: Map<string, Array<{ path: string; sourceInfo?: SourceInfo }>>;
    }
  > = {
    user: { scope: "user", paths: [], packages: new Map() },
    project: { scope: "project", paths: [], packages: new Map() },
    path: { scope: "path", paths: [], packages: new Map() },
  };

  for (const item of items) {
    const groupKey = self.getScopeGroup(item.sourceInfo);
    const group = groups[groupKey];
    const source = item.sourceInfo?.source ?? "local";

    if (self.isPackageSource(item.sourceInfo)) {
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
