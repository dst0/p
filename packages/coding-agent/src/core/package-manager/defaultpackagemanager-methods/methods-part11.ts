import { dirname, join, resolve } from "node:path";
import { Minimatch } from "minimatch";
import type { SettingsManager } from "../../settings-manager.ts";
import type { DefaultPackageManager } from "../defaultpackagemanager.ts";
import { getHomeDir, toPosixPath } from "../helpers-part1.ts";
import { collectAutoSkillEntries } from "../helpers-part2.ts";
import { collectAncestorAgentsSkillDirs, collectAutoPromptEntries, collectAutoThemeEntries } from "../helpers-part3.ts";
import {
  collectAutoExtensionEntries,
  getOverridePatterns,
  matchesAnyExactPattern,
  matchesAnyPattern,
  normalizeExactPattern,
} from "../helpers-part4.ts";
import type { PathMetadata, ResourceAccumulator, ResourceType } from "../types-part1.ts";

export function do_addAutoDiscoveredResources(
  self: DefaultPackageManager,
  accumulator: ResourceAccumulator,
  globalSettings: ReturnType<SettingsManager["getGlobalSettings"]>,
  projectSettings: ReturnType<SettingsManager["getProjectSettings"]>,
  globalBaseDir: string,
  projectBaseDir: string,
): void {
  const userMetadata: PathMetadata = {
    source: "auto",
    scope: "user",
    origin: "top-level",
    baseDir: globalBaseDir,
  };
  const projectMetadata: PathMetadata = {
    source: "auto",
    scope: "project",
    origin: "top-level",
    baseDir: projectBaseDir,
  };

  const userOverrides = {
    extensions: (globalSettings.extensions ?? []) as string[],
    skills: (globalSettings.skills ?? []) as string[],
    prompts: (globalSettings.prompts ?? []) as string[],
    themes: (globalSettings.themes ?? []) as string[],
  };
  const projectOverrides = {
    extensions: (projectSettings.extensions ?? []) as string[],
    skills: (projectSettings.skills ?? []) as string[],
    prompts: (projectSettings.prompts ?? []) as string[],
    themes: (projectSettings.themes ?? []) as string[],
  };

  const userDirs = {
    extensions: join(globalBaseDir, "extensions"),
    skills: join(globalBaseDir, "skills"),
    prompts: join(globalBaseDir, "prompts"),
    themes: join(globalBaseDir, "themes"),
  };
  const projectDirs = {
    extensions: join(projectBaseDir, "extensions"),
    skills: join(projectBaseDir, "skills"),
    prompts: join(projectBaseDir, "prompts"),
    themes: join(projectBaseDir, "themes"),
  };
  const userAgentsSkillsDir = join(getHomeDir(), ".agents", "skills");
  const projectTrusted = self.settingsManager.isProjectTrusted();
  const projectAgentsSkillDirs = projectTrusted
    ? collectAncestorAgentsSkillDirs(self.cwd).filter((dir) => resolve(dir) !== resolve(userAgentsSkillsDir))
    : [];

  const addResources = (
    resourceType: ResourceType,
    paths: string[],
    metadata: PathMetadata,
    overrides: string[],
    baseDir: string,
  ) => {
    const target = self.getTargetMap(accumulator, resourceType);

    // ⚡ Bolt: Pre-compile Minimatch instances outside of tight per-file loops
    const overridePatterns = getOverridePatterns(overrides);
    const excludes = overridePatterns.filter((pattern) => pattern.startsWith("!")).map((pattern) => pattern.slice(1));
    const compiledExcludes = excludes.map((pattern) => new Minimatch(toPosixPath(pattern)));
    const forceIncludes = overridePatterns
      .filter((pattern) => pattern.startsWith("+"))
      .map((pattern) => pattern.slice(1));
    const forceExcludes = overridePatterns
      .filter((pattern) => pattern.startsWith("-"))
      .map((pattern) => pattern.slice(1));

    const forceIncludesSet = new Set(forceIncludes.map(normalizeExactPattern));
    const forceExcludesSet = new Set(forceExcludes.map(normalizeExactPattern));

    for (const path of paths) {
      let enabled = true;
      if (excludes.length > 0 && matchesAnyPattern(path, compiledExcludes, baseDir)) {
        enabled = false;
      }
      if (forceIncludesSet.size > 0 && matchesAnyExactPattern(path, forceIncludesSet, baseDir)) {
        enabled = true;
      }
      if (forceExcludesSet.size > 0 && matchesAnyExactPattern(path, forceExcludesSet, baseDir)) {
        enabled = false;
      }
      self.addResource(target, path, metadata, enabled);
    }
  };

  if (projectTrusted) {
    // Project extensions from .p/
    addResources(
      "extensions",
      collectAutoExtensionEntries(projectDirs.extensions),
      projectMetadata,
      projectOverrides.extensions,
      projectBaseDir,
    );

    // Project skills from .p/
    addResources(
      "skills",
      collectAutoSkillEntries(projectDirs.skills, "p"),
      projectMetadata,
      projectOverrides.skills,
      projectBaseDir,
    );
  }

  // Project skills from .agents/ (each with its own baseDir)
  for (const agentsSkillsDir of projectAgentsSkillDirs) {
    const agentsBaseDir = dirname(agentsSkillsDir); // the .agents directory
    const agentsMetadata: PathMetadata = {
      ...projectMetadata,
      baseDir: agentsBaseDir,
    };
    addResources(
      "skills",
      collectAutoSkillEntries(agentsSkillsDir, "agents"),
      agentsMetadata,
      projectOverrides.skills,
      agentsBaseDir,
    );
  }

  if (projectTrusted) {
    addResources(
      "prompts",
      collectAutoPromptEntries(projectDirs.prompts),
      projectMetadata,
      projectOverrides.prompts,
      projectBaseDir,
    );
    addResources(
      "themes",
      collectAutoThemeEntries(projectDirs.themes),
      projectMetadata,
      projectOverrides.themes,
      projectBaseDir,
    );
  }

  // User extensions from ~/.p/agent/
  addResources(
    "extensions",
    collectAutoExtensionEntries(userDirs.extensions),
    userMetadata,
    userOverrides.extensions,
    globalBaseDir,
  );

  // User skills from ~/.p/agent/
  addResources(
    "skills",
    collectAutoSkillEntries(userDirs.skills, "p"),
    userMetadata,
    userOverrides.skills,
    globalBaseDir,
  );

  // User skills from ~/.agents/ (with its own baseDir)
  const userAgentsBaseDir = dirname(userAgentsSkillsDir);
  const userAgentsMetadata: PathMetadata = {
    ...userMetadata,
    baseDir: userAgentsBaseDir,
  };
  addResources(
    "skills",
    collectAutoSkillEntries(userAgentsSkillsDir, "agents"),
    userAgentsMetadata,
    userOverrides.skills,
    userAgentsBaseDir,
  );

  addResources(
    "prompts",
    collectAutoPromptEntries(userDirs.prompts),
    userMetadata,
    userOverrides.prompts,
    globalBaseDir,
  );
  addResources("themes", collectAutoThemeEntries(userDirs.themes), userMetadata, userOverrides.themes, globalBaseDir);
}
