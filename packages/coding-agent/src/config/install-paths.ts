import { accessSync, constants, existsSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve, sep } from "path";
import { normalizePath } from "../utils/paths.ts";
import {
  CONFIG_DIR_NAME,
  DEFAULT_SHARE_VIEWER_URL,
  ENV_AGENT_DIR,
  ENV_SESSION_DIR,
  isBunBinary,
  LEGACY_ENV_AGENT_DIR,
  LEGACY_ENV_SESSION_DIR,
} from "./constants.ts";
import { getGlobalPackageRoots, getPathComparisonCandidates, getSelfUpdateCommandForMethod } from "./package-roots.ts";
import { detectInstallMethod, findGitRoot, getPackageDir } from "./self-update.ts";
import type { InstallMethod, SelfUpdateCommand } from "./types.ts";

export function getEntrypointPackageDir(): string | undefined {
  const entrypoint = process.argv[1];
  if (!entrypoint) return undefined;
  let dir = dirname(entrypoint);
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, "package.json"))) {
      return dir;
    }
    dir = dirname(dir);
  }
  return undefined;
}

export function isSelfUpdatePathWritable(): boolean {
  const packageDir = getPackageDir();
  try {
    accessSync(packageDir, constants.W_OK);
    accessSync(dirname(packageDir), constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function isManagedByGlobalPackageManager(
  method: InstallMethod,
  packageName: string,
  npmCommand?: string[],
): boolean {
  const packageDirs = [getPackageDir(), getEntrypointPackageDir()].filter((dir): dir is string => !!dir);
  const packageDirCandidates = packageDirs.flatMap((dir) => getPathComparisonCandidates(dir));
  return getGlobalPackageRoots(method, packageName, npmCommand).some((root) => {
    return getPathComparisonCandidates(root).some((normalizedRoot) => {
      const rootPrefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
      return packageDirCandidates.some((packageDir) => packageDir.startsWith(rootPrefix));
    });
  });
}

export function getSelfUpdateCommand(
  packageName: string,
  npmCommand?: string[],
  updatePackageName = packageName,
): SelfUpdateCommand | undefined {
  const method = detectInstallMethod();
  const command = getSelfUpdateCommandForMethod(method, packageName, updatePackageName, npmCommand);
  if (!command) {
    return undefined;
  }
  // Source checkouts are not managed by a global package manager — skip that check.
  if (method !== "source-checkout" && !isManagedByGlobalPackageManager(method, packageName, npmCommand)) {
    return undefined;
  }
  if (!isSelfUpdatePathWritable()) {
    return undefined;
  }
  return command;
}

export function getSelfUpdateUnavailableInstruction(
  packageName: string,
  npmCommand?: string[],
  updatePackageName = packageName,
): string {
  const method = detectInstallMethod();
  if (method === "bun-binary") {
    return `Download from: https://github.com/dst0/p-mono/releases/latest`;
  }
  if (method === "source-checkout") {
    return `Run: cd ${findGitRoot(getPackageDir())} && git pull && npm run build`;
  }
  const command = getSelfUpdateCommandForMethod(method, packageName, updatePackageName, npmCommand);
  if (command) {
    if (isManagedByGlobalPackageManager(method, packageName, npmCommand) && !isSelfUpdatePathWritable()) {
      return `This installation is managed by a global ${method} install, but the install path is not writable. Update it yourself with: ${command.display}`;
    }
    return `This installation is not managed by a global ${method} install. Update it with the package manager, wrapper, or source checkout that provides it.`;
  }
  return `Update ${updatePackageName} using the package manager, wrapper, or source checkout that provides this installation.`;
}

export function getUpdateInstruction(packageName: string): string {
  const method = detectInstallMethod();
  const command = getSelfUpdateCommandForMethod(method, packageName);
  if (command) {
    return `Run: ${command.display}`;
  }
  return getSelfUpdateUnavailableInstruction(packageName);
}

export function getThemesDir(): string {
  if (isBunBinary) {
    return join(getPackageDir(), "theme");
  }
  // Theme is in modes/interactive/theme/ relative to src/ or dist/
  const packageDir = getPackageDir();
  const srcOrDist = existsSync(join(packageDir, "src")) ? "src" : "dist";
  return join(packageDir, srcOrDist, "modes", "interactive", "theme");
}

export function getExportTemplateDir(): string {
  if (isBunBinary) {
    return join(getPackageDir(), "export-html");
  }
  const packageDir = getPackageDir();
  const srcOrDist = existsSync(join(packageDir, "src")) ? "src" : "dist";
  return join(packageDir, srcOrDist, "core", "export-html");
}

export function getPackageJsonPath(): string {
  return join(getPackageDir(), "package.json");
}

export function getReadmePath(): string {
  return resolve(join(getPackageDir(), "README.md"));
}

export function getDocsPath(): string {
  return resolve(join(getPackageDir(), "docs"));
}

export function getExamplesPath(): string {
  return resolve(join(getPackageDir(), "examples"));
}

export function getChangelogPath(): string {
  return resolve(join(getPackageDir(), "CHANGELOG.md"));
}

export function getBundledSkillsDir(): string {
  return resolve(join(getPackageDir(), "skills"));
}

export function getInteractiveAssetsDir(): string {
  if (isBunBinary) {
    return join(getPackageDir(), "assets");
  }
  const packageDir = getPackageDir();
  const srcOrDist = existsSync(join(packageDir, "src")) ? "src" : "dist";
  return join(packageDir, srcOrDist, "modes", "interactive", "assets");
}

export function getBundledInteractiveAssetPath(name: string): string {
  return join(getInteractiveAssetsDir(), name);
}

export function expandTildePath(path: string): string {
  return normalizePath(path);
}

export function getShareViewerUrl(gistId: string): string {
  const baseUrl = process.env.P_SHARE_VIEWER_URL || DEFAULT_SHARE_VIEWER_URL;
  return `${baseUrl}#${gistId}`;
}

export function getAgentDir(): string {
  const envDir = process.env[ENV_AGENT_DIR];
  if (envDir) {
    return expandTildePath(envDir);
  }
  return join(homedir(), CONFIG_DIR_NAME, "agent");
}

export function installLegacyAgentDirEnvAlias(sessionDir?: string): void {
  if (ENV_AGENT_DIR === LEGACY_ENV_AGENT_DIR) {
    return;
  }
  process.env[LEGACY_ENV_AGENT_DIR] = getAgentDir();
  if (ENV_SESSION_DIR === LEGACY_ENV_SESSION_DIR) {
    return;
  }
  const currentSessionDir = sessionDir ?? process.env[ENV_SESSION_DIR];
  if (currentSessionDir) {
    process.env[LEGACY_ENV_SESSION_DIR] = expandTildePath(currentSessionDir);
  }
}
