import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CONFIG_DIR_NAME } from "../../../config.ts";
import type { GitSource } from "../../../utils/git.ts";
import { markPathIgnoredByCloudSync } from "../../../utils/paths.ts";
import { NETWORK_TIMEOUT_MS } from "../constants.ts";
import type { DefaultPackageManager } from "../defaultpackagemanager.ts";
import { isOfflineModeEnabled } from "../helpers-part1.ts";
import type { NpmSource, SourceScope } from "../types-part1.ts";

export async function do_updateGit(self: DefaultPackageManager, source: GitSource, scope: SourceScope): Promise<void> {
  const targetDir = self.getGitInstallPath(source, scope);
  if (!existsSync(targetDir)) {
    await self.installGit(source, scope);
    return;
  }

  if (source.ref) {
    await self.ensureGitRef(targetDir, ["fetch", "origin", source.ref], "FETCH_HEAD");
    return;
  }

  const target = await self.getLocalGitUpdateTarget(targetDir);
  await self.ensureGitRef(targetDir, target.fetchArgs, target.ref);
}

export async function do_ensureGitRef(
  self: DefaultPackageManager,
  targetDir: string,
  fetchArgs: string[],
  ref: string,
): Promise<void> {
  // Fetch only the ref we will reset to, avoiding unrelated branch/tag noise.
  await self.runCommand("git", fetchArgs, { cwd: targetDir });

  const localHead = await self.runCommandCapture("git", ["rev-parse", "HEAD"], {
    cwd: targetDir,
    timeoutMs: NETWORK_TIMEOUT_MS,
  });
  const commitRef = `${ref}^{commit}`;
  const targetHead = await self.runCommandCapture("git", ["rev-parse", commitRef], {
    cwd: targetDir,
    timeoutMs: NETWORK_TIMEOUT_MS,
  });
  if (localHead.trim() === targetHead.trim()) {
    return;
  }

  await self.runCommand("git", ["reset", "--hard", commitRef], { cwd: targetDir });

  // Clean untracked files (extensions should be pristine)
  await self.runCommand("git", ["clean", "-fdx"], { cwd: targetDir });

  const packageJsonPath = join(targetDir, "package.json");
  if (existsSync(packageJsonPath)) {
    await self.runNpmCommand(self.getGitDependencyInstallArgs(), { cwd: targetDir });
  }
}

export async function do_refreshTemporaryGitSource(
  self: DefaultPackageManager,
  source: GitSource,
  sourceStr: string,
): Promise<void> {
  if (isOfflineModeEnabled()) {
    return;
  }
  try {
    await self.withProgress("pull", sourceStr, `Refreshing ${sourceStr}...`, async () => {
      await self.updateGit(source, "temporary");
    });
  } catch {
    // Keep cached temporary checkout if refresh fails.
  }
}

export async function do_removeGit(self: DefaultPackageManager, source: GitSource, scope: SourceScope): Promise<void> {
  const targetDir = self.getGitInstallPath(source, scope);
  if (!existsSync(targetDir)) return;
  rmSync(targetDir, { recursive: true, force: true });
  self.pruneEmptyGitParents(targetDir, self.getGitInstallRoot(scope));
}

export function do_pruneEmptyGitParents(
  _self: DefaultPackageManager,
  targetDir: string,
  installRoot: string | undefined,
): void {
  if (!installRoot) return;
  const resolvedRoot = resolve(installRoot);
  let current = dirname(targetDir);
  while (current.startsWith(resolvedRoot) && current !== resolvedRoot) {
    if (!existsSync(current)) {
      current = dirname(current);
      continue;
    }
    const entries = readdirSync(current);
    if (entries.length > 0) {
      break;
    }
    try {
      rmSync(current, { recursive: true, force: true });
    } catch {
      break;
    }
    current = dirname(current);
  }
}

export function do_ensureNpmProject(self: DefaultPackageManager, installRoot: string): void {
  if (!existsSync(installRoot)) {
    mkdirSync(installRoot, { recursive: true });
  }
  markPathIgnoredByCloudSync(installRoot);
  self.ensureGitIgnore(installRoot);
  const packageJsonPath = join(installRoot, "package.json");
  if (!existsSync(packageJsonPath)) {
    const pkgJson = { name: "p-extensions", private: true };
    writeFileSync(packageJsonPath, JSON.stringify(pkgJson, null, 2), "utf-8");
  }
}

export function do_ensureGitIgnore(_self: DefaultPackageManager, dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const ignorePath = join(dir, ".gitignore");
  if (!existsSync(ignorePath)) {
    writeFileSync(ignorePath, "*\n!.gitignore\n", "utf-8");
  }
}

export function do_getNpmInstallRoot(self: DefaultPackageManager, scope: SourceScope, temporary: boolean): string {
  if (temporary) {
    return self.getTemporaryDir("npm");
  }
  if (scope === "project") {
    self.assertProjectTrustedForScope(scope);
    return join(self.cwd, CONFIG_DIR_NAME, "npm");
  }
  return join(self.agentDir, "npm");
}

export function do_getGlobalNpmRoot(self: DefaultPackageManager): string {
  const npmCommand = self.getNpmCommand();
  const commandKey = [npmCommand.command, ...npmCommand.args].join("\0");
  if (self.globalNpmRoot && self.globalNpmRootCommandKey === commandKey) {
    return self.globalNpmRoot;
  }
  if (self.getPackageManagerName() === "bun") {
    const binDir = self.runNpmCommandSync(["pm", "bin", "-g"]).trim();
    self.globalNpmRoot = join(dirname(binDir), "install", "global", "node_modules");
  } else {
    self.globalNpmRoot = self.runNpmCommandSync(["root", "-g"]).trim();
  }
  self.globalNpmRootCommandKey = commandKey;
  return self.globalNpmRoot;
}

export function do_getPnpmGlobalPackagePath(self: DefaultPackageManager, packageName: string): string | undefined {
  if (self.getPackageManagerName() !== "pnpm") {
    return undefined;
  }

  const output = self.runNpmCommandSync(["list", "-g", "--depth", "0", "--json"]);
  const entries = JSON.parse(output) as Array<{ dependencies?: Record<string, { path?: string }> }>;
  for (const entry of entries) {
    const path = entry.dependencies?.[packageName]?.path;
    if (path) return path;
  }
  return undefined;
}

export function do_getManagedNpmInstallPath(
  self: DefaultPackageManager,
  source: NpmSource,
  scope: SourceScope,
): string {
  if (scope === "temporary") {
    return join(self.getTemporaryDir("npm"), "node_modules", source.name);
  }
  if (scope === "project") {
    self.assertProjectTrustedForScope(scope);
    return join(self.cwd, CONFIG_DIR_NAME, "npm", "node_modules", source.name);
  }
  return join(self.agentDir, "npm", "node_modules", source.name);
}
