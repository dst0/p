import { existsSync } from "node:fs";
import type { DefaultPackageManager } from "../defaultpackagemanager.ts";
import type { ConfiguredPackage, ConfiguredUpdateSource, SourceScope } from "../types.ts";

export function do_listConfiguredPackages(self: DefaultPackageManager): ConfiguredPackage[] {
  const globalSettings = self.settingsManager.getGlobalSettings();
  const projectSettings = self.settingsManager.getProjectSettings();
  const configuredPackages: ConfiguredPackage[] = [];

  for (const pkg of globalSettings.packages ?? []) {
    const source = typeof pkg === "string" ? pkg : pkg.source;
    configuredPackages.push({
      source,
      scope: "user",
      filtered: typeof pkg === "object",
      installedPath: self.getInstalledPath(source, "user"),
    });
  }

  for (const pkg of projectSettings.packages ?? []) {
    const source = typeof pkg === "string" ? pkg : pkg.source;
    configuredPackages.push({
      source,
      scope: "project",
      filtered: typeof pkg === "object",
      installedPath: self.getInstalledPath(source, "project"),
    });
  }

  return configuredPackages;
}

export async function do_install(
  self: DefaultPackageManager,
  source: string,
  options?: { local?: boolean },
): Promise<void> {
  const parsed = self.parseSource(source);
  const scope: SourceScope = options?.local ? "project" : "user";
  self.assertProjectTrustedForScope(scope);
  await self.withProgress("install", source, `Installing ${source}...`, async () => {
    if (parsed.type === "npm") {
      await self.installNpm(parsed, scope, false);
      return;
    }
    if (parsed.type === "git") {
      await self.installGit(parsed, scope);
      return;
    }
    if (parsed.type === "local") {
      const resolved = self.resolvePath(parsed.path);
      if (!existsSync(resolved)) {
        throw new Error(`Path does not exist: ${resolved}`);
      }
      return;
    }
    throw new Error(`Unsupported install source: ${source}`);
  });
}

export async function do_installAndPersist(
  self: DefaultPackageManager,
  source: string,
  options?: { local?: boolean },
): Promise<void> {
  await self.install(source, options);
  self.addSourceToSettings(source, options);
}

export async function do_remove(
  self: DefaultPackageManager,
  source: string,
  options?: { local?: boolean },
): Promise<void> {
  const parsed = self.parseSource(source);
  const scope: SourceScope = options?.local ? "project" : "user";
  self.assertProjectTrustedForScope(scope);
  await self.withProgress("remove", source, `Removing ${source}...`, async () => {
    if (parsed.type === "npm") {
      await self.uninstallNpm(parsed, scope);
      return;
    }
    if (parsed.type === "git") {
      await self.removeGit(parsed, scope);
      return;
    }
    if (parsed.type === "local") {
      return;
    }
    throw new Error(`Unsupported remove source: ${source}`);
  });
}

export async function do_removeAndPersist(
  self: DefaultPackageManager,
  source: string,
  options?: { local?: boolean },
): Promise<boolean> {
  await self.remove(source, options);
  return self.removeSourceFromSettings(source, options);
}

export async function do_update(self: DefaultPackageManager, source?: string): Promise<void> {
  const globalSettings = self.settingsManager.getGlobalSettings();
  const projectSettings = self.settingsManager.getProjectSettings();
  const identity = source ? self.getPackageIdentity(source) : undefined;
  let matched = false;
  const updateSources: ConfiguredUpdateSource[] = [];

  for (const pkg of globalSettings.packages ?? []) {
    const sourceStr = typeof pkg === "string" ? pkg : pkg.source;
    if (identity && self.getPackageIdentity(sourceStr, "user") !== identity) continue;
    matched = true;
    updateSources.push({ source: sourceStr, scope: "user" });
  }
  for (const pkg of projectSettings.packages ?? []) {
    const sourceStr = typeof pkg === "string" ? pkg : pkg.source;
    if (identity && self.getPackageIdentity(sourceStr, "project") !== identity) continue;
    matched = true;
    updateSources.push({ source: sourceStr, scope: "project" });
  }

  if (source && !matched) {
    throw new Error(
      self.buildNoMatchingPackageMessage(source, [
        ...(globalSettings.packages ?? []),
        ...(projectSettings.packages ?? []),
      ]),
    );
  }

  await self.updateConfiguredSources(updateSources);
}
