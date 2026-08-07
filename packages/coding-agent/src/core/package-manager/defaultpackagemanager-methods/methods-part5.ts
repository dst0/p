import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { satisfies } from "semver";
import { parseGitUrl } from "../../../utils/git.ts";
import { isLocalPath } from "../../../utils/paths.ts";
import type { PackageSource } from "../../settings-manager.ts";
import type { DefaultPackageManager } from "../defaultpackagemanager.ts";
import { getNpmVersionRange, isExactNpmVersion, isOfflineModeEnabled } from "../helpers-part1.ts";
import type { NpmSource, ParsedSource, SourceScope } from "../types-part1.ts";

export async function do_installParsedSource(
  self: DefaultPackageManager,
  parsed: ParsedSource,
  scope: SourceScope,
): Promise<void> {
  if (parsed.type === "npm") {
    await self.installNpm(parsed, scope, scope === "temporary");
    return;
  }
  if (parsed.type === "git") {
    await self.installGit(parsed, scope);
    return;
  }
}

export function do_getPackageSourceString(_self: DefaultPackageManager, pkg: PackageSource): string {
  return typeof pkg === "string" ? pkg : pkg.source;
}

export function do_getSourceMatchKeyForInput(self: DefaultPackageManager, source: string): string {
  const parsed = self.parseSource(source);
  if (parsed.type === "npm") {
    return `npm:${parsed.name}`;
  }
  if (parsed.type === "git") {
    return `git:${parsed.host}/${parsed.path}`;
  }
  return `local:${self.resolvePath(parsed.path)}`;
}

export function do_getSourceMatchKeyForSettings(
  self: DefaultPackageManager,
  source: string,
  scope: SourceScope,
): string {
  const parsed = self.parseSource(source);
  if (parsed.type === "npm") {
    return `npm:${parsed.name}`;
  }
  if (parsed.type === "git") {
    return `git:${parsed.host}/${parsed.path}`;
  }
  const baseDir = self.getBaseDirForScope(scope);
  return `local:${self.resolvePathFromBase(parsed.path, baseDir)}`;
}

export function do_buildNoMatchingPackageMessage(
  self: DefaultPackageManager,
  source: string,
  configuredPackages: PackageSource[],
): string {
  const suggestion = self.findSuggestedConfiguredSource(source, configuredPackages);
  if (!suggestion) {
    return `No matching package found for ${source}`;
  }
  return `No matching package found for ${source}. Did you mean ${suggestion}?`;
}

export function do_findSuggestedConfiguredSource(
  self: DefaultPackageManager,
  source: string,
  configuredPackages: PackageSource[],
): string | undefined {
  const trimmedSource = source.trim();
  const suggestions = new Set<string>();

  for (const pkg of configuredPackages) {
    const sourceStr = self.getPackageSourceString(pkg);
    const parsed = self.parseSource(sourceStr);
    if (parsed.type === "npm") {
      if (trimmedSource === parsed.name || trimmedSource === parsed.spec) {
        suggestions.add(sourceStr);
      }
      continue;
    }
    if (parsed.type === "git") {
      const shorthand = `${parsed.host}/${parsed.path}`;
      const shorthandWithRef = parsed.ref ? `${shorthand}@${parsed.ref}` : undefined;
      if (trimmedSource === shorthand || (shorthandWithRef && trimmedSource === shorthandWithRef)) {
        suggestions.add(sourceStr);
      }
    }
  }

  return suggestions.values().next().value;
}

export function do_packageSourcesMatch(
  self: DefaultPackageManager,
  existing: PackageSource,
  inputSource: string,
  scope: SourceScope,
): boolean {
  const left = self.getSourceMatchKeyForSettings(self.getPackageSourceString(existing), scope);
  const right = self.getSourceMatchKeyForInput(inputSource);
  return left === right;
}

export function do_normalizePackageSourceForSettings(
  self: DefaultPackageManager,
  source: string,
  scope: SourceScope,
): string {
  const parsed = self.parseSource(source);
  if (parsed.type !== "local") {
    return source;
  }
  const baseDir = self.getBaseDirForScope(scope);
  const resolved = self.resolvePath(parsed.path);
  const rel = relative(baseDir, resolved);
  return rel || ".";
}

export function do_parseSource(self: DefaultPackageManager, source: string): ParsedSource {
  if (source.startsWith("npm:")) {
    const spec = source.slice("npm:".length).trim();
    const { name, version } = self.parseNpmSpec(spec);
    return {
      type: "npm",
      spec,
      name,
      version,
      range: getNpmVersionRange(version),
      pinned: isExactNpmVersion(version),
    };
  }

  if (isLocalPath(source)) {
    return { type: "local", path: source };
  }

  // Try parsing as git URL
  const gitParsed = parseGitUrl(source);
  if (gitParsed) {
    return gitParsed;
  }

  return { type: "local", path: source };
}

export async function do_installedNpmMatchesConfiguredVersion(
  self: DefaultPackageManager,
  source: NpmSource,
  installedPath: string,
): Promise<boolean> {
  const installedVersion = self.getInstalledNpmVersion(installedPath);
  if (!installedVersion) {
    return false;
  }
  return source.range ? satisfies(installedVersion, source.range) : true;
}

export async function do_npmHasAvailableUpdate(
  self: DefaultPackageManager,
  source: NpmSource,
  installedPath: string,
): Promise<boolean> {
  if (isOfflineModeEnabled()) {
    return false;
  }

  const installedVersion = self.getInstalledNpmVersion(installedPath);
  if (!installedVersion) {
    return false;
  }

  try {
    const targetVersion = await self.getLatestNpmVersion(source.version ? source.spec : source.name, source.range);
    return targetVersion !== installedVersion;
  } catch {
    return false;
  }
}

export function do_getInstalledNpmVersion(_self: DefaultPackageManager, installedPath: string): string | undefined {
  const packageJsonPath = join(installedPath, "package.json");
  if (!existsSync(packageJsonPath)) return undefined;
  try {
    const content = readFileSync(packageJsonPath, "utf-8");
    const pkg = JSON.parse(content) as { version?: string };
    return pkg.version;
  } catch {
    return undefined;
  }
}
