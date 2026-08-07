import { existsSync, statSync } from "node:fs";
import { dirname } from "node:path";
import type { PackageSource } from "../../settings-manager.ts";
import { UPDATE_CHECK_CONCURRENCY } from "../constants.ts";
import type { DefaultPackageManager } from "../defaultpackagemanager.ts";
import { isOfflineModeEnabled } from "../helpers-part1.ts";
import type {
  LocalSource,
  MissingSourceAction,
  PackageFilter,
  PackageUpdate,
  PathMetadata,
  ResourceAccumulator,
  SourceScope,
} from "../types-part1.ts";

export async function do_checkForAvailableUpdates(self: DefaultPackageManager): Promise<PackageUpdate[]> {
  if (isOfflineModeEnabled()) {
    return [];
  }

  const globalSettings = self.settingsManager.getGlobalSettings();
  const projectSettings = self.settingsManager.getProjectSettings();
  const allPackages: Array<{ pkg: PackageSource; scope: SourceScope }> = [];
  for (const pkg of projectSettings.packages ?? []) {
    allPackages.push({ pkg, scope: "project" });
  }
  for (const pkg of globalSettings.packages ?? []) {
    allPackages.push({ pkg, scope: "user" });
  }

  const packageSources = self.dedupePackages(allPackages);
  const checks = packageSources
    .filter(
      (entry): entry is { pkg: PackageSource; scope: Exclude<SourceScope, "temporary"> } => entry.scope !== "temporary",
    )
    .map((entry) => async (): Promise<PackageUpdate | undefined> => {
      const source = typeof entry.pkg === "string" ? entry.pkg : entry.pkg.source;
      const parsed = self.parseSource(source);
      if (parsed.type === "local" || parsed.pinned) {
        return undefined;
      }

      if (parsed.type === "npm") {
        const installedPath = self.getNpmInstallPath(parsed, entry.scope);
        if (!existsSync(installedPath)) {
          return undefined;
        }
        const hasUpdate = await self.npmHasAvailableUpdate(parsed, installedPath);
        if (!hasUpdate) {
          return undefined;
        }
        return {
          source,
          displayName: parsed.name,
          type: "npm",
          scope: entry.scope,
        };
      }

      const installedPath = self.getGitInstallPath(parsed, entry.scope);
      if (!existsSync(installedPath)) {
        return undefined;
      }
      const hasUpdate = await self.gitHasAvailableUpdate(installedPath);
      if (!hasUpdate) {
        return undefined;
      }
      return {
        source,
        displayName: `${parsed.host}/${parsed.path}`,
        type: "git",
        scope: entry.scope,
      };
    });

  const results = await self.runWithConcurrency(checks, UPDATE_CHECK_CONCURRENCY);
  return results.filter((result): result is PackageUpdate => result !== undefined);
}

export async function do_resolvePackageSources(
  self: DefaultPackageManager,
  sources: Array<{ pkg: PackageSource; scope: SourceScope }>,
  accumulator: ResourceAccumulator,
  onMissing?: (source: string) => Promise<MissingSourceAction>,
): Promise<void> {
  for (const { pkg, scope } of sources) {
    const sourceStr = typeof pkg === "string" ? pkg : pkg.source;
    const filter = typeof pkg === "object" ? pkg : undefined;
    const parsed = self.parseSource(sourceStr);
    const metadata: PathMetadata = { source: sourceStr, scope, origin: "package" };

    if (parsed.type === "local") {
      const baseDir = self.getBaseDirForScope(scope);
      self.resolveLocalExtensionSource(parsed, accumulator, filter, metadata, baseDir);
      continue;
    }

    const installMissing = async (): Promise<boolean> => {
      if (isOfflineModeEnabled()) {
        return false;
      }
      if (!onMissing) {
        await self.installParsedSource(parsed, scope);
        return true;
      }
      const action = await onMissing(sourceStr);
      if (action === "skip") return false;
      if (action === "error") throw new Error(`Missing source: ${sourceStr}`);
      await self.installParsedSource(parsed, scope);
      return true;
    };

    if (parsed.type === "npm") {
      let installedPath = self.getNpmInstallPath(parsed, scope);
      const needsInstall =
        !existsSync(installedPath) || !(await self.installedNpmMatchesConfiguredVersion(parsed, installedPath));
      if (needsInstall) {
        const installed = await installMissing();
        if (!installed) continue;
        installedPath = self.getNpmInstallPath(parsed, scope);
      }
      metadata.baseDir = installedPath;
      self.collectPackageResources(installedPath, accumulator, filter, metadata);
      continue;
    }

    if (parsed.type === "git") {
      const installedPath = self.getGitInstallPath(parsed, scope);
      if (!existsSync(installedPath)) {
        const installed = await installMissing();
        if (!installed) continue;
      } else if (scope === "temporary" && !parsed.pinned && !isOfflineModeEnabled()) {
        await self.refreshTemporaryGitSource(parsed, sourceStr);
      }
      metadata.baseDir = installedPath;
      self.collectPackageResources(installedPath, accumulator, filter, metadata);
    }
  }
}

export function do_resolveLocalExtensionSource(
  self: DefaultPackageManager,
  source: LocalSource,
  accumulator: ResourceAccumulator,
  filter: PackageFilter | undefined,
  metadata: PathMetadata,
  baseDir: string,
): void {
  const resolved = self.resolvePathFromBase(source.path, baseDir);
  if (!existsSync(resolved)) {
    return;
  }

  try {
    const stats = statSync(resolved);
    if (stats.isFile()) {
      metadata.baseDir = dirname(resolved);
      self.addResource(accumulator.extensions, resolved, metadata, true);
      return;
    }
    if (stats.isDirectory()) {
      metadata.baseDir = resolved;
      const resources = self.collectPackageResources(resolved, accumulator, filter, metadata);
      if (!resources) {
        self.addResource(accumulator.extensions, resolved, metadata, true);
      }
    }
  } catch {
    return;
  }
}
