/**
 * Path formatting helpers for display in the TUI.
 * Extracted from InteractiveMode.
 */

import * as os from "node:os";
import * as path from "node:path";
import type { SourceInfo } from "../../../core/source-info.ts";
import { parseGitUrl } from "../../../utils/git.ts";
import { getCwdRelativePath } from "../../../utils/paths.ts";

/**
 * Format a path for display, replacing home directory with ~.
 */
export function formatDisplayPath(p: string): string {
  const home = os.homedir();
  let result = p;
  if (result.startsWith(home)) {
    result = `~${result.slice(home.length)}`;
  }
  return result;
}

/**
 * Format an extension display path, stripping /index.ts and /index.js suffixes.
 */
export function formatExtensionDisplayPath(p: string): string {
  let result = formatDisplayPath(p);
  result = result.replace(/\/index\.ts$/, "").replace(/\/index\.js$/, "");
  return result;
}

/**
 * Format a path relative to cwd for context display.
 */
export function formatContextPath(cwd: string, p: string): string {
  const absolutePath = path.isAbsolute(p) ? path.resolve(p) : path.resolve(cwd, p);
  const relativePath = getCwdRelativePath(absolutePath, cwd);
  if (relativePath !== undefined) {
    return relativePath;
  }
  return formatDisplayPath(absolutePath);
}

/**
 * Get a short path relative to the package root for display.
 */
export function getShortPath(fullPath: string, sourceInfo?: SourceInfo): string {
  const isPackageSource = (si?: SourceInfo): boolean => {
    const source = si?.source ?? "";
    return source.startsWith("npm:") || source.startsWith("git:");
  };

  const baseDir = sourceInfo?.baseDir;
  if (baseDir && isPackageSource(sourceInfo)) {
    const relativePath = path.relative(path.resolve(baseDir), path.resolve(fullPath));
    if (
      relativePath &&
      relativePath !== "." &&
      !relativePath.startsWith("..") &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath)
    ) {
      return relativePath.replace(/\\/g, "/");
    }
  }

  const source = sourceInfo?.source ?? "";
  const npmMatch = fullPath.match(/node_modules\/(@?[^/]+(?:\/[^/]+)?)\/(.*)/);
  if (npmMatch && source.startsWith("npm:")) {
    return npmMatch[2];
  }

  const gitMatch = fullPath.match(/git\/[^/]+\/[^/]+\/(.*)/);
  if (gitMatch && source.startsWith("git:")) {
    return gitMatch[1];
  }

  return formatDisplayPath(fullPath);
}

/**
 * Get a compact label for a path (last segment).
 */
export function getCompactPathLabel(resourcePath: string, sourceInfo?: SourceInfo): string {
  const shortPath = getShortPath(resourcePath, sourceInfo);
  const normalizedPath = shortPath.replace(/\\/g, "/");
  const segments = normalizedPath.split("/").filter((segment) => segment.length > 0 && segment !== "~");
  if (segments.length > 0) {
    return segments[segments.length - 1]!;
  }
  return shortPath;
}

/**
 * Get a compact label for a package source.
 */
export function getCompactPackageSourceLabel(sourceInfo?: SourceInfo): string {
  const source = sourceInfo?.source ?? "";
  if (source.startsWith("npm:")) {
    return source.slice("npm:".length) || source;
  }
  const gitSource = parseGitUrl(source);
  if (gitSource) {
    return gitSource.path || source;
  }
  return source;
}

/**
 * Get a compact extension label.
 */
export function getCompactExtensionLabel(resourcePath: string, sourceInfo?: SourceInfo): string {
  const isPackageSource = (si?: SourceInfo): boolean => {
    const source = si?.source ?? "";
    return source.startsWith("npm:") || source.startsWith("git:");
  };

  if (!isPackageSource(sourceInfo)) {
    return getCompactPathLabel(resourcePath, sourceInfo);
  }

  const sourceLabel = getCompactPackageSourceLabel(sourceInfo);
  if (!sourceLabel) {
    return getCompactPathLabel(resourcePath, sourceInfo);
  }

  const shortPath = getShortPath(resourcePath, sourceInfo).replace(/\\/g, "/");
  const packagePath = shortPath.startsWith("extensions/") ? shortPath.slice("extensions/".length) : shortPath;
  const parsedPath = path.posix.parse(packagePath);

  if (parsedPath.name === "index") {
    return !parsedPath.dir || parsedPath.dir === "." ? sourceLabel : `${sourceLabel}:${parsedPath.dir}`;
  }

  return `${sourceLabel}:${packagePath}`;
}

/**
 * Get compact display path segments.
 */
export function getCompactDisplayPathSegments(resourcePath: string): string[] {
  return formatDisplayPath(resourcePath)
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== "~");
}

/**
 * Get a compact non-package extension label that is unique among all paths.
 */
export function getCompactNonPackageExtensionLabel(
  resourcePath: string,
  index: number,
  allPaths: Array<{ path: string; segments: string[] }>,
): string {
  const segments = allPaths[index]?.segments;
  if (!segments || segments.length === 0) {
    return getCompactPathLabel(resourcePath);
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

/**
 * Get compact extension labels for an array of extensions.
 */
export function getCompactExtensionLabels(extensions: Array<{ path: string; sourceInfo?: SourceInfo }>): string[] {
  const isPackageSource = (si?: SourceInfo): boolean => {
    const source = si?.source ?? "";
    return source.startsWith("npm:") || source.startsWith("git:");
  };

  const nonPackageExtensions = extensions
    .map((extension) => {
      const segments = getCompactDisplayPathSegments(extension.path);
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
    .filter((extension) => !isPackageSource(extension.sourceInfo));

  return extensions.map((extension) => {
    if (isPackageSource(extension.sourceInfo)) {
      return getCompactExtensionLabel(extension.path, extension.sourceInfo);
    }

    const nonPackageIndex = nonPackageExtensions.findIndex((item) => item.path === extension.path);
    if (nonPackageIndex === -1) {
      return getCompactPathLabel(extension.path, extension.sourceInfo);
    }

    return getCompactNonPackageExtensionLabel(extension.path, nonPackageIndex, nonPackageExtensions);
  });
}
