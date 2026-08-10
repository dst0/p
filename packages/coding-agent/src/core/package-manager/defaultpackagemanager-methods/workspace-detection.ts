import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { GitSource } from "../../../utils/git.ts";
import type { PackageSource } from "../../settings-manager.ts";
import type { DefaultPackageManager } from "../defaultpackagemanager.ts";
import type { NpmSource, SourceScope } from "../types.ts";

export function do_getPackageIdentity(self: DefaultPackageManager, source: string, scope?: SourceScope): string {
  const parsed = self.parseSource(source);
  if (parsed.type === "npm") {
    return `npm:${parsed.name}`;
  }
  if (parsed.type === "git") {
    // Use host/path for identity to normalize SSH and HTTPS
    return `git:${parsed.host}/${parsed.path}`;
  }
  if (scope) {
    const baseDir = self.getBaseDirForScope(scope);
    return `local:${self.resolvePathFromBase(parsed.path, baseDir)}`;
  }
  return `local:${self.resolvePath(parsed.path)}`;
}

export function do_dedupePackages(
  self: DefaultPackageManager,
  packages: Array<{ pkg: PackageSource; scope: SourceScope }>,
): Array<{ pkg: PackageSource; scope: SourceScope }> {
  const seen = new Map<string, { pkg: PackageSource; scope: SourceScope }>();

  for (const entry of packages) {
    const sourceStr = typeof entry.pkg === "string" ? entry.pkg : entry.pkg.source;
    const identity = self.getPackageIdentity(sourceStr, entry.scope);

    const existing = seen.get(identity);
    if (!existing) {
      seen.set(identity, entry);
    } else if (entry.scope === "project" && existing.scope === "user") {
      // Project wins over user
      seen.set(identity, entry);
    }
    // If existing is project and new is global, keep existing (project)
    // If both are same scope, keep first one
  }

  return Array.from(seen.values());
}

export function do_parseNpmSpec(_self: DefaultPackageManager, spec: string): { name: string; version?: string } {
  const match = spec.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/);
  if (!match) {
    return { name: spec };
  }
  const name = match[1] ?? spec;
  const version = match[2];
  return { name, version };
}

export function do_assertProjectTrustedForScope(self: DefaultPackageManager, scope: SourceScope): void {
  if (scope === "project" && !self.settingsManager.isProjectTrusted()) {
    throw new Error("Project is not trusted; refusing to access project package storage");
  }
}

export function do_getNpmCommand(self: DefaultPackageManager): { command: string; args: string[] } {
  const configuredCommand = self.settingsManager.getNpmCommand();
  if (!configuredCommand || configuredCommand.length === 0) {
    return { command: "npm", args: [] };
  }
  const [command, ...args] = configuredCommand;
  if (!command) {
    throw new Error("Invalid npmCommand: first array entry must be a non-empty command");
  }
  return { command, args };
}

export function do_getPackageManagerName(self: DefaultPackageManager): string {
  const npmCommand = self.getNpmCommand();
  const commandParts = [npmCommand.command, ...npmCommand.args];
  const separatorIndex = commandParts.lastIndexOf("--");
  const packageManagerCommand = separatorIndex >= 0 ? commandParts[separatorIndex + 1] : npmCommand.command;
  return packageManagerCommand ? basename(packageManagerCommand).replace(/\.(cmd|exe)$/i, "") : "";
}

export async function do_runNpmCommand(
  self: DefaultPackageManager,
  args: string[],
  options?: { cwd?: string },
): Promise<void> {
  const npmCommand = self.getNpmCommand();
  await self.runCommand(npmCommand.command, [...npmCommand.args, ...args], options);
}

export function do_getGitDependencyInstallArgs(self: DefaultPackageManager): string[] {
  const configuredCommand = self.settingsManager.getNpmCommand();
  if (configuredCommand && configuredCommand.length > 0) {
    return ["install"];
  }
  return ["install", "--omit=dev"];
}

export function do_runNpmCommandSync(self: DefaultPackageManager, args: string[]): string {
  const npmCommand = self.getNpmCommand();
  return self.runCommandSync(npmCommand.command, [...npmCommand.args, ...args]);
}

export function do_getNpmInstallArgs(self: DefaultPackageManager, specs: string[], installRoot: string): string[] {
  const packageManagerName = self.getPackageManagerName();
  // Extension packages run inside p and resolve p APIs through loader aliases/virtual modules.
  // Disable peer dependency resolution for managed installs (npm's --legacy-peer-deps, and
  // equivalent bun/pnpm settings) so package managers do not install or solve host-provided
  // @dst0/p-* peers. Stale auto-installed p peers can otherwise block updates.
  if (packageManagerName === "bun") {
    return ["install", ...specs, "--cwd", installRoot, "--omit=peer"];
  }
  if (packageManagerName === "pnpm") {
    return [
      "install",
      ...specs,
      "--prefix",
      installRoot,
      "--config.auto-install-peers=false",
      "--config.strict-peer-dependencies=false",
      "--config.strict-dep-builds=false",
    ];
  }
  return ["install", ...specs, "--prefix", installRoot, "--legacy-peer-deps"];
}

export async function do_installNpm(
  self: DefaultPackageManager,
  source: NpmSource,
  scope: SourceScope,
  temporary: boolean,
): Promise<void> {
  const installRoot = self.getNpmInstallRoot(scope, temporary);
  self.ensureNpmProject(installRoot);
  await self.runNpmCommand(self.getNpmInstallArgs([source.spec], installRoot));
}

export async function do_uninstallNpm(
  self: DefaultPackageManager,
  source: NpmSource,
  scope: SourceScope,
): Promise<void> {
  const installRoot = self.getNpmInstallRoot(scope, false);
  if (!existsSync(installRoot)) {
    return;
  }
  if (self.getPackageManagerName() === "bun") {
    await self.runNpmCommand(["uninstall", source.name, "--cwd", installRoot]);
    return;
  }
  await self.runNpmCommand(["uninstall", source.name, "--prefix", installRoot]);
}

export async function do_installGit(self: DefaultPackageManager, source: GitSource, scope: SourceScope): Promise<void> {
  const targetDir = self.getGitInstallPath(source, scope);
  if (existsSync(targetDir)) {
    if (source.ref) {
      await self.ensureGitRef(targetDir, ["fetch", "origin", source.ref], "FETCH_HEAD");
      return;
    }
    const target = await self.getLocalGitUpdateTarget(targetDir);
    await self.ensureGitRef(targetDir, target.fetchArgs, target.ref);
    return;
  }
  const gitRoot = self.getGitInstallRoot(scope);
  if (gitRoot) {
    self.ensureGitIgnore(gitRoot);
  }
  mkdirSync(dirname(targetDir), { recursive: true });

  await self.runCommand("git", ["clone", source.repo, targetDir]);
  if (source.ref) {
    await self.runCommand("git", ["checkout", source.ref], { cwd: targetDir });
  }
  const packageJsonPath = join(targetDir, "package.json");
  if (existsSync(packageJsonPath)) {
    await self.runNpmCommand(self.getGitDependencyInstallArgs(), { cwd: targetDir });
  }
}
