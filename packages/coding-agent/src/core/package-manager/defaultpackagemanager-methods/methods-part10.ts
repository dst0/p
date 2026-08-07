import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { globSync } from "glob";
import type { DefaultPackageManager } from "../defaultpackagemanager.ts";
import { hasGlobPattern, isOverridePattern, splitPatterns } from "../helpers-part1.ts";
import { collectResourceFiles } from "../helpers-part4.ts";
import { applyPatterns } from "../helpers-part5.ts";
import type { PathMetadata, PiManifest, ResourceType } from "../types-part1.ts";

export function do_collectManifestFiles(
  self: DefaultPackageManager,
  packageRoot: string,
  resourceType: ResourceType,
): { allFiles: string[]; enabledByManifest: Set<string> } {
  const manifest = self.readPiManifest(packageRoot);
  const entries = manifest?.[resourceType as keyof PiManifest];
  if (entries && entries.length > 0) {
    const allFiles = self.collectFilesFromManifestEntries(entries, packageRoot, resourceType);
    const manifestPatterns = entries.filter(isOverridePattern);
    const enabledByManifest =
      manifestPatterns.length > 0 ? applyPatterns(allFiles, manifestPatterns, packageRoot) : new Set(allFiles);
    return { allFiles: Array.from(enabledByManifest), enabledByManifest };
  }

  const conventionDir = join(packageRoot, resourceType);
  if (!existsSync(conventionDir)) {
    return { allFiles: [], enabledByManifest: new Set() };
  }
  const allFiles = collectResourceFiles(conventionDir, resourceType);
  return { allFiles, enabledByManifest: new Set(allFiles) };
}

export function do_readPiManifest(_self: DefaultPackageManager, packageRoot: string): PiManifest | null {
  const packageJsonPath = join(packageRoot, "package.json");
  if (!existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const content = readFileSync(packageJsonPath, "utf-8");
    const pkg = JSON.parse(content) as { p?: PiManifest; pi?: PiManifest };
    return pkg.p ?? pkg.pi ?? null;
  } catch {
    return null;
  }
}

export function do_addManifestEntries(
  self: DefaultPackageManager,
  entries: string[] | undefined,
  root: string,
  resourceType: ResourceType,
  target: Map<string, { metadata: PathMetadata; enabled: boolean }>,
  metadata: PathMetadata,
): void {
  if (!entries) return;

  const allFiles = self.collectFilesFromManifestEntries(entries, root, resourceType);
  const patterns = entries.filter(isOverridePattern);
  const enabledPaths = applyPatterns(allFiles, patterns, root);

  for (const f of allFiles) {
    if (enabledPaths.has(f)) {
      self.addResource(target, f, metadata, true);
    }
  }
}

export function do_collectFilesFromManifestEntries(
  self: DefaultPackageManager,
  entries: string[],
  root: string,
  resourceType: ResourceType,
): string[] {
  const sourceEntries = entries.filter((entry) => !isOverridePattern(entry));
  const resolved = sourceEntries.flatMap((entry) => {
    if (!hasGlobPattern(entry)) {
      return [resolve(root, entry)];
    }

    return globSync(entry, {
      cwd: root,
      absolute: true,
      dot: false,
      nodir: false,
    }).map((match) => resolve(match));
  });
  return self.collectFilesFromPaths(resolved, resourceType);
}

export function do_resolveLocalEntries(
  self: DefaultPackageManager,
  entries: string[],
  resourceType: ResourceType,
  target: Map<string, { metadata: PathMetadata; enabled: boolean }>,
  metadata: PathMetadata,
  baseDir: string,
): void {
  if (entries.length === 0) return;

  // Collect all files from plain entries (non-pattern entries)
  const { plain, patterns } = splitPatterns(entries);
  const resolvedPlain = plain.map((p) => self.resolvePathFromBase(p, baseDir));
  const allFiles = self.collectFilesFromPaths(resolvedPlain, resourceType);

  // Determine which files are enabled based on patterns
  const enabledPaths = applyPatterns(allFiles, patterns, baseDir);

  // Add all files with their enabled state
  for (const f of allFiles) {
    self.addResource(target, f, metadata, enabledPaths.has(f));
  }
}
