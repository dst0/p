import { existsSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "../../../config.ts";
import type { PackageSource } from "../../settings-manager.ts";
import { RESOURCE_TYPES } from "../constants.ts";
import type { DefaultPackageManager } from "../defaultpackagemanager.ts";
import type { MissingSourceAction, ProgressCallback, ProgressEvent, ResolvedPaths, SourceScope } from "../types.ts";

export function do_setProgressCallback(self: DefaultPackageManager, callback: ProgressCallback | undefined): void {
  self.progressCallback = callback;
}

export function do_addSourceToSettings(
  self: DefaultPackageManager,
  source: string,
  options?: { local?: boolean },
): boolean {
  const scope: SourceScope = options?.local ? "project" : "user";
  const currentSettings =
    scope === "project" ? self.settingsManager.getProjectSettings() : self.settingsManager.getGlobalSettings();
  const currentPackages = currentSettings.packages ?? [];
  const normalizedSource = self.normalizePackageSourceForSettings(source, scope);
  const matchIndex = currentPackages.findIndex((existing) => self.packageSourcesMatch(existing, source, scope));
  if (matchIndex !== -1) {
    const existing = currentPackages[matchIndex];
    if (self.getPackageSourceString(existing) === normalizedSource) {
      return false;
    }
    const nextPackages = [...currentPackages];
    nextPackages[matchIndex] =
      typeof existing === "string" ? normalizedSource : { ...existing, source: normalizedSource };
    if (scope === "project") {
      self.settingsManager.setProjectPackages(nextPackages);
    } else {
      self.settingsManager.setPackages(nextPackages);
    }
    return true;
  }
  const nextPackages = [...currentPackages, normalizedSource];
  if (scope === "project") {
    self.settingsManager.setProjectPackages(nextPackages);
  } else {
    self.settingsManager.setPackages(nextPackages);
  }
  return true;
}

export function do_removeSourceFromSettings(
  self: DefaultPackageManager,
  source: string,
  options?: { local?: boolean },
): boolean {
  const scope: SourceScope = options?.local ? "project" : "user";
  const currentSettings =
    scope === "project" ? self.settingsManager.getProjectSettings() : self.settingsManager.getGlobalSettings();
  const currentPackages = currentSettings.packages ?? [];
  const nextPackages = currentPackages.filter((existing) => !self.packageSourcesMatch(existing, source, scope));
  const changed = nextPackages.length !== currentPackages.length;
  if (!changed) {
    return false;
  }
  if (scope === "project") {
    self.settingsManager.setProjectPackages(nextPackages);
  } else {
    self.settingsManager.setPackages(nextPackages);
  }
  return true;
}

export function do_getInstalledPath(
  self: DefaultPackageManager,
  source: string,
  scope: "user" | "project",
): string | undefined {
  const parsed = self.parseSource(source);
  if (parsed.type === "npm") {
    const path = self.getNpmInstallPath(parsed, scope);
    return existsSync(path) ? path : undefined;
  }
  if (parsed.type === "git") {
    const path = self.getGitInstallPath(parsed, scope);
    return existsSync(path) ? path : undefined;
  }
  if (parsed.type === "local") {
    const baseDir = self.getBaseDirForScope(scope);
    const path = self.resolvePathFromBase(parsed.path, baseDir);
    return existsSync(path) ? path : undefined;
  }
  return undefined;
}

export function do_emitProgress(self: DefaultPackageManager, event: ProgressEvent): void {
  self.progressCallback?.(event);
}

export async function do_withProgress(
  self: DefaultPackageManager,
  action: ProgressEvent["action"],
  source: string,
  message: string,
  operation: () => Promise<void>,
): Promise<void> {
  self.emitProgress({ type: "start", action, source, message });
  try {
    await operation();
    self.emitProgress({ type: "complete", action, source });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    self.emitProgress({ type: "error", action, source, message: errorMessage });
    throw error;
  }
}

export async function do_resolve(
  self: DefaultPackageManager,
  onMissing?: (source: string) => Promise<MissingSourceAction>,
): Promise<ResolvedPaths> {
  const accumulator = self.createAccumulator();
  const globalSettings = self.settingsManager.getGlobalSettings();
  const projectSettings = self.settingsManager.getProjectSettings();

  // Collect all packages with scope (project first so cwd resources win collisions)
  const allPackages: Array<{ pkg: PackageSource; scope: SourceScope }> = [];
  for (const pkg of projectSettings.packages ?? []) {
    allPackages.push({ pkg, scope: "project" });
  }
  for (const pkg of globalSettings.packages ?? []) {
    allPackages.push({ pkg, scope: "user" });
  }

  // Dedupe: project scope wins over global for same package identity
  const packageSources = self.dedupePackages(allPackages);
  await self.resolvePackageSources(packageSources, accumulator, onMissing);

  const globalBaseDir = self.agentDir;
  const projectBaseDir = join(self.cwd, CONFIG_DIR_NAME);

  for (const resourceType of RESOURCE_TYPES) {
    const target = self.getTargetMap(accumulator, resourceType);
    const globalEntries = (globalSettings[resourceType] ?? []) as string[];
    const projectEntries = (projectSettings[resourceType] ?? []) as string[];
    self.resolveLocalEntries(
      projectEntries,
      resourceType,
      target,
      {
        source: "local",
        scope: "project",
        origin: "top-level",
      },
      projectBaseDir,
    );
    self.resolveLocalEntries(
      globalEntries,
      resourceType,
      target,
      {
        source: "local",
        scope: "user",
        origin: "top-level",
      },
      globalBaseDir,
    );
  }

  self.addAutoDiscoveredResources(accumulator, globalSettings, projectSettings, globalBaseDir, projectBaseDir);

  return self.toResolvedPaths(accumulator);
}

export async function do_resolveExtensionSources(
  self: DefaultPackageManager,
  sources: string[],
  options?: { local?: boolean; temporary?: boolean },
): Promise<ResolvedPaths> {
  const accumulator = self.createAccumulator();
  const scope: SourceScope = options?.temporary ? "temporary" : options?.local ? "project" : "user";
  const packageSources = sources.map((source) => ({ pkg: source as PackageSource, scope }));
  await self.resolvePackageSources(packageSources, accumulator);
  return self.toResolvedPaths(accumulator);
}
