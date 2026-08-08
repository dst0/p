import { existsSync } from "node:fs";
import { GIT_UPDATE_CONCURRENCY, UPDATE_CHECK_CONCURRENCY } from "../constants.ts";
import type { DefaultPackageManager } from "../defaultpackagemanager.ts";
import type {
  ConfiguredUpdateSource,
  GitUpdateTarget,
  InstalledSourceScope,
  NpmSource,
  NpmUpdateTarget,
} from "../types.ts";
import { isOfflineModeEnabled } from "../version-resolution.ts";

export async function do_updateConfiguredSources(
  self: DefaultPackageManager,
  sources: ConfiguredUpdateSource[],
): Promise<void> {
  if (isOfflineModeEnabled() || sources.length === 0) {
    return;
  }

  const npmCandidates: NpmUpdateTarget[] = [];
  const gitCandidates: GitUpdateTarget[] = [];

  for (const entry of sources) {
    const parsed = self.parseSource(entry.source);
    // Pinned npm versions are fixed. Pinned git refs are configured checkout targets,
    // so include them to reconcile an existing clone when the configured ref changes.
    if (parsed.type === "npm") {
      if (!parsed.pinned) {
        npmCandidates.push({ ...entry, parsed });
      }
    } else if (parsed.type === "git") {
      gitCandidates.push({ ...entry, parsed });
    }
  }

  const npmCheckTasks = npmCandidates.map((entry) => async () => ({
    entry,
    shouldUpdate: await self.shouldUpdateNpmSource(entry.parsed, entry.scope),
  }));
  const npmCheckResults = await self.runWithConcurrency(npmCheckTasks, UPDATE_CHECK_CONCURRENCY);
  const userNpmUpdates: NpmUpdateTarget[] = [];
  const projectNpmUpdates: NpmUpdateTarget[] = [];
  for (const result of npmCheckResults) {
    if (!result.shouldUpdate) {
      continue;
    }
    if (result.entry.scope === "user") {
      userNpmUpdates.push(result.entry);
    } else {
      projectNpmUpdates.push(result.entry);
    }
  }

  const tasks: Promise<void>[] = [];
  if (userNpmUpdates.length > 0) {
    tasks.push(self.updateNpmBatch(userNpmUpdates, "user"));
  }
  if (projectNpmUpdates.length > 0) {
    tasks.push(self.updateNpmBatch(projectNpmUpdates, "project"));
  }
  if (gitCandidates.length > 0) {
    const gitTasks = gitCandidates.map(
      (entry) => async () =>
        self.withProgress("update", entry.source, `Updating ${entry.source}...`, async () => {
          await self.updateGit(entry.parsed, entry.scope);
        }),
    );
    tasks.push(self.runWithConcurrency(gitTasks, GIT_UPDATE_CONCURRENCY).then(() => {}));
  }

  await Promise.all(tasks);
}

export async function do_shouldUpdateNpmSource(
  self: DefaultPackageManager,
  source: NpmSource,
  scope: InstalledSourceScope,
): Promise<boolean> {
  const installedPath = self.getManagedNpmInstallPath(source, scope);
  const installedVersion = existsSync(installedPath) ? self.getInstalledNpmVersion(installedPath) : undefined;
  if (!installedVersion) {
    return true;
  }

  try {
    const targetVersion = await self.getLatestNpmVersion(source.version ? source.spec : source.name, source.range);
    return targetVersion !== installedVersion;
  } catch {
    // Preserve existing update behavior when version lookup fails.
    return true;
  }
}

export async function do_updateNpmBatch(
  self: DefaultPackageManager,
  sources: NpmUpdateTarget[],
  scope: InstalledSourceScope,
): Promise<void> {
  if (sources.length === 0) {
    return;
  }

  const sourceLabel = sources.length === 1 ? sources[0].source : `${scope} npm packages`;
  const message = sources.length === 1 ? `Updating ${sources[0].source}...` : `Updating ${scope} npm packages...`;
  const specs = sources.map((entry) => (entry.parsed.version ? entry.parsed.spec : `${entry.parsed.name}@latest`));

  await self.withProgress("update", sourceLabel, message, async () => {
    await self.installNpmBatch(specs, scope);
  });
}

export async function do_installNpmBatch(
  self: DefaultPackageManager,
  specs: string[],
  scope: InstalledSourceScope,
): Promise<void> {
  const installRoot = self.getNpmInstallRoot(scope, false);
  self.ensureNpmProject(installRoot);
  await self.runNpmCommand(self.getNpmInstallArgs(specs, installRoot));
}
