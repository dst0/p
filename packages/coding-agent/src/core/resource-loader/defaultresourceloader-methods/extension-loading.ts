import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolvePath } from "../../../utils/paths.ts";
import type { ResourceDiagnostic } from "../../diagnostics.ts";
import { loadExtensions } from "../../extensions/loader.ts";
import type { Extension, LoadExtensionsResult } from "../../extensions/types.ts";
import type { PathMetadata, ResolvedResource } from "../../package-manager.ts";
import type { Skill } from "../../skills.ts";
import { loadSkills } from "../../skills.ts";
import type { DefaultResourceLoader } from "../defaultresourceloader.ts";

export async function do_loadCurrentExtensionSet(
  self: DefaultResourceLoader,
  options: { includeInlineFactories: boolean },
): Promise<LoadExtensionsResult> {
  const resolvedPaths = await self.packageManager.resolve();
  const cliExtensionPaths = await self.packageManager.resolveExtensionSources(self.additionalExtensionPaths, {
    temporary: true,
  });
  const enabledExtensions = resolvedPaths.extensions.filter((r) => r.enabled).map((r) => r.path);
  const cliEnabledExtensions = cliExtensionPaths.extensions.filter((r) => r.enabled).map((r) => r.path);
  const extensionPaths = self.noExtensions
    ? cliEnabledExtensions
    : self.mergePaths(cliEnabledExtensions, enabledExtensions);
  const extensionsResult = await loadExtensions(extensionPaths, self.cwd, self.eventBus);
  if (!options.includeInlineFactories) {
    return extensionsResult;
  }

  const inlineExtensions = await self.loadExtensionFactories(extensionsResult.runtime);
  extensionsResult.extensions.push(...inlineExtensions.extensions);
  extensionsResult.errors.push(...inlineExtensions.errors);
  return extensionsResult;
}

export function do_resolveExtensionLoadPath(self: DefaultResourceLoader, path: string): string {
  return resolvePath(path, self.cwd, { normalizeUnicodeSpaces: true });
}

export async function do_loadFinalExtensionSet(
  self: DefaultResourceLoader,
  extensionPaths: string[],
  preTrustExtensions: LoadExtensionsResult | undefined,
): Promise<LoadExtensionsResult> {
  if (!preTrustExtensions) {
    const extensionsResult = await loadExtensions(extensionPaths, self.cwd, self.eventBus);
    const inlineExtensions = await self.loadExtensionFactories(extensionsResult.runtime);
    extensionsResult.extensions.push(...inlineExtensions.extensions);
    extensionsResult.errors.push(...inlineExtensions.errors);
    self.addExtensionConflictDiagnostics(extensionsResult);
    return extensionsResult;
  }

  const preloadedByPath = new Map(
    preTrustExtensions.extensions
      .filter((extension) => !extension.path.startsWith("<inline:"))
      .map((extension) => [extension.resolvedPath, extension]),
  );
  const failedPreloadPaths = new Set(
    preTrustExtensions.errors.map((error) => self.resolveExtensionLoadPath(error.path)),
  );
  const remainingPaths = extensionPaths.filter((path) => {
    const resolvedPath = self.resolveExtensionLoadPath(path);
    return !preloadedByPath.has(resolvedPath) && !failedPreloadPaths.has(resolvedPath);
  });
  const remainingExtensions = await loadExtensions(remainingPaths, self.cwd, self.eventBus, preTrustExtensions.runtime);
  const loadedByPath = new Map(preloadedByPath);
  for (const extension of remainingExtensions.extensions) {
    loadedByPath.set(extension.resolvedPath, extension);
  }

  const inlineExtensions = preTrustExtensions.extensions.filter((extension) => extension.path.startsWith("<inline:"));
  const orderedExtensions = extensionPaths
    .map((path) => loadedByPath.get(self.resolveExtensionLoadPath(path)))
    .filter((extension): extension is Extension => extension !== undefined);
  orderedExtensions.push(...inlineExtensions);

  const extensionsResult: LoadExtensionsResult = {
    extensions: orderedExtensions,
    errors: [...preTrustExtensions.errors, ...remainingExtensions.errors],
    runtime: preTrustExtensions.runtime,
  };
  self.addExtensionConflictDiagnostics(extensionsResult);
  return extensionsResult;
}

export function do_addExtensionConflictDiagnostics(
  self: DefaultResourceLoader,
  extensionsResult: LoadExtensionsResult,
): void {
  // Detect extension conflicts (tools, commands, flags with same names from different extensions)
  // Keep all extensions loaded. Conflicts are reported as diagnostics, and precedence is handled by load order.
  const conflicts = self.detectExtensionConflicts(extensionsResult.extensions);
  for (const conflict of conflicts) {
    extensionsResult.errors.push({ path: conflict.path, error: conflict.message });
  }
}

export function do_mapSkillPath(
  _self: DefaultResourceLoader,
  resource: ResolvedResource,
  metadataByPath: Map<string, PathMetadata>,
): string {
  if (resource.metadata.source !== "auto" && resource.metadata.origin !== "package") {
    return resource.path;
  }
  try {
    const stats = statSync(resource.path);
    if (!stats.isDirectory()) {
      return resource.path;
    }
  } catch {
    return resource.path;
  }
  const skillFile = join(resource.path, "SKILL.md");
  if (existsSync(skillFile)) {
    if (!metadataByPath.has(skillFile)) {
      metadataByPath.set(skillFile, resource.metadata);
    }
    return skillFile;
  }
  return resource.path;
}

export function do_normalizeExtensionPaths(
  self: DefaultResourceLoader,
  entries: Array<{ path: string; metadata: PathMetadata }>,
): Array<{ path: string; metadata: PathMetadata }> {
  return entries.map((entry) => {
    const metadata = entry.metadata.baseDir
      ? { ...entry.metadata, baseDir: self.resolveResourcePath(entry.metadata.baseDir) }
      : entry.metadata;
    return {
      path: self.resolveResourcePath(entry.path),
      metadata,
    };
  });
}

export function do_updateSkillsFromPaths(
  self: DefaultResourceLoader,
  skillPaths: string[],
  metadataByPath?: Map<string, PathMetadata>,
): void {
  let skillsResult: { skills: Skill[]; diagnostics: ResourceDiagnostic[] };
  if (self.noSkills && skillPaths.length === 0) {
    skillsResult = { skills: [], diagnostics: [] };
  } else {
    skillsResult = loadSkills({
      cwd: self.cwd,
      agentDir: self.agentDir,
      skillPaths,
      includeDefaults: false,
      includeBundled: !self.noSkills,
    });
  }
  const resolvedSkills = self.skillsOverride ? self.skillsOverride(skillsResult) : skillsResult;
  self.skills = resolvedSkills.skills.map((skill) => ({
    ...skill,
    sourceInfo:
      self.findSourceInfoForPath(skill.filePath, self.extensionSkillSourceInfos, metadataByPath) ??
      skill.sourceInfo ??
      self.getDefaultSourceInfoForPath(skill.filePath),
  }));
  self.skillDiagnostics = resolvedSkills.diagnostics;
}
