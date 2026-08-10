import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { CONFIG_DIR_NAME } from "../../../config.ts";
import type { GitSource } from "../../../utils/git.ts";
import { resolvePath } from "../../../utils/paths.ts";
import { collectResourceFiles } from "../binary-resolution.ts";
import { applyPatterns } from "../cache-management.ts";
import { RESOURCE_TYPES } from "../constants.ts";
import type { DefaultPackageManager } from "../defaultpackagemanager.ts";
import type {
  NpmSource,
  PackageFilter,
  PathMetadata,
  PiManifest,
  ResourceAccumulator,
  ResourceType,
  SourceScope,
} from "../types.ts";
import { getExtensionTempFolder, getHomeDir } from "../version-resolution.ts";

export function do_getLegacyGlobalNpmInstallPath(self: DefaultPackageManager, source: NpmSource): string | undefined {
  try {
    return self.getPnpmGlobalPackagePath(source.name) ?? join(self.getGlobalNpmRoot(), source.name);
  } catch {
    return undefined;
  }
}

export function do_getNpmInstallPath(self: DefaultPackageManager, source: NpmSource, scope: SourceScope): string {
  const managedPath = self.getManagedNpmInstallPath(source, scope);
  if (scope !== "user" || existsSync(managedPath)) {
    return managedPath;
  }
  const legacyPath = self.getLegacyGlobalNpmInstallPath(source);
  return legacyPath && existsSync(legacyPath) ? legacyPath : managedPath;
}

export function do_getGitInstallPath(self: DefaultPackageManager, source: GitSource, scope: SourceScope): string {
  if (scope === "temporary") {
    return self.getTemporaryDir(`git-${source.host}`, source.path);
  }
  const installRoot = self.getGitInstallRoot(scope);
  if (!installRoot) {
    throw new Error("Missing git install root");
  }
  return self.resolveManagedPath(installRoot, source.host, source.path);
}

export function do_getGitInstallRoot(self: DefaultPackageManager, scope: SourceScope): string | undefined {
  if (scope === "temporary") {
    return undefined;
  }
  if (scope === "project") {
    self.assertProjectTrustedForScope(scope);
    return join(self.cwd, CONFIG_DIR_NAME, "git");
  }
  return join(self.agentDir, "git");
}

export function do_getTemporaryDir(self: DefaultPackageManager, prefix: string, suffix?: string): string {
  const root = self.resolveManagedPath(getExtensionTempFolder(self.agentDir), prefix);
  const hash = createHash("sha256")
    .update(`${prefix}-${suffix ?? ""}`)
    .digest("hex")
    .slice(0, 8);
  return self.resolveManagedPath(root, hash, suffix ?? "");
}

export function do_resolveManagedPath(_self: DefaultPackageManager, root: string, ...parts: string[]): string {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(resolvedRoot, ...parts);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`Refusing to use path outside package install root: ${resolvedPath}`);
  }
  return resolvedPath;
}

export function do_getBaseDirForScope(self: DefaultPackageManager, scope: SourceScope): string {
  if (scope === "project") {
    self.assertProjectTrustedForScope(scope);
    return join(self.cwd, CONFIG_DIR_NAME);
  }
  if (scope === "user") {
    return self.agentDir;
  }
  return self.cwd;
}

export function do_resolvePath(self: DefaultPackageManager, input: string): string {
  return resolvePath(input, self.cwd, { homeDir: getHomeDir(), trim: true });
}

export function do_resolvePathFromBase(_self: DefaultPackageManager, input: string, baseDir: string): string {
  return resolvePath(input, baseDir, { homeDir: getHomeDir(), trim: true });
}

export function do_collectPackageResources(
  self: DefaultPackageManager,
  packageRoot: string,
  accumulator: ResourceAccumulator,
  filter: PackageFilter | undefined,
  metadata: PathMetadata,
): boolean {
  if (filter) {
    for (const resourceType of RESOURCE_TYPES) {
      const patterns = filter[resourceType as keyof PackageFilter];
      const target = self.getTargetMap(accumulator, resourceType);
      if (patterns !== undefined) {
        self.applyPackageFilter(packageRoot, patterns, resourceType, target, metadata);
      } else {
        self.collectDefaultResources(packageRoot, resourceType, target, metadata);
      }
    }
    return true;
  }

  const manifest = self.readPiManifest(packageRoot);
  if (manifest) {
    for (const resourceType of RESOURCE_TYPES) {
      const entries = manifest[resourceType as keyof PiManifest];
      self.addManifestEntries(
        entries,
        packageRoot,
        resourceType,
        self.getTargetMap(accumulator, resourceType),
        metadata,
      );
    }
    return true;
  }

  let hasAnyDir = false;
  for (const resourceType of RESOURCE_TYPES) {
    const dir = join(packageRoot, resourceType);
    if (existsSync(dir)) {
      // Collect all files from the directory (all enabled by default)
      const files = collectResourceFiles(dir, resourceType);
      for (const f of files) {
        self.addResource(self.getTargetMap(accumulator, resourceType), f, metadata, true);
      }
      hasAnyDir = true;
    }
  }
  return hasAnyDir;
}

export function do_collectDefaultResources(
  self: DefaultPackageManager,
  packageRoot: string,
  resourceType: ResourceType,
  target: Map<string, { metadata: PathMetadata; enabled: boolean }>,
  metadata: PathMetadata,
): void {
  const manifest = self.readPiManifest(packageRoot);
  const entries = manifest?.[resourceType as keyof PiManifest];
  if (entries) {
    self.addManifestEntries(entries, packageRoot, resourceType, target, metadata);
    return;
  }
  const dir = join(packageRoot, resourceType);
  if (existsSync(dir)) {
    // Collect all files from the directory (all enabled by default)
    const files = collectResourceFiles(dir, resourceType);
    for (const f of files) {
      self.addResource(target, f, metadata, true);
    }
  }
}

export function do_applyPackageFilter(
  self: DefaultPackageManager,
  packageRoot: string,
  userPatterns: string[],
  resourceType: ResourceType,
  target: Map<string, { metadata: PathMetadata; enabled: boolean }>,
  metadata: PathMetadata,
): void {
  const { allFiles } = self.collectManifestFiles(packageRoot, resourceType);

  if (userPatterns.length === 0) {
    // Empty array explicitly disables all resources of this type
    for (const f of allFiles) {
      self.addResource(target, f, metadata, false);
    }
    return;
  }

  // Apply user patterns
  const enabledByUser = applyPatterns(allFiles, userPatterns, packageRoot);

  for (const f of allFiles) {
    const enabled = enabledByUser.has(f);
    self.addResource(target, f, metadata, enabled);
  }
}
