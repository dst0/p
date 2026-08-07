import { existsSync } from "node:fs";
import { isLocalPath } from "../../../utils/paths.ts";
import type { LoadExtensionsResult } from "../../extensions/types.ts";
import type { PathMetadata, ResolvedResource } from "../../package-manager.ts";
import type { DefaultResourceLoader } from "../defaultresourceloader.ts";
import { loadProjectContextFiles, resolvePromptInput } from "../helpers.ts";
import type { ResourceLoaderReloadOptions } from "../types.ts";

export async function do_reload(self: DefaultResourceLoader, options?: ResourceLoaderReloadOptions): Promise<void> {
  let preTrustExtensions: LoadExtensionsResult | undefined;
  if (options?.resolveProjectTrust) {
    preTrustExtensions = await self.loadProjectTrustExtensions();
    const projectTrusted = await options.resolveProjectTrust({ extensionsResult: preTrustExtensions });
    self.settingsManager.setProjectTrusted(projectTrusted);
  }

  // reload() preserves SettingsManager.projectTrusted and reloads settings for that trust state.
  await self.settingsManager.reload();
  const resolvedPaths = await self.packageManager.resolve();
  const cliExtensionPaths = await self.packageManager.resolveExtensionSources(self.additionalExtensionPaths, {
    temporary: true,
  });
  const metadataByPath = new Map<string, PathMetadata>();

  self.extensionSkillSourceInfos = new Map();
  self.extensionPromptSourceInfos = new Map();
  self.extensionThemeSourceInfos = new Map();

  // Helper to extract enabled paths and store metadata
  const getEnabledResources = (resources: ResolvedResource[]): ResolvedResource[] => {
    for (const r of resources) {
      if (!metadataByPath.has(r.path)) {
        metadataByPath.set(r.path, r.metadata);
      }
    }
    return resources.filter((r) => r.enabled);
  };

  const getEnabledPaths = (resources: ResolvedResource[]): string[] =>
    getEnabledResources(resources).map((r) => r.path);
  const enabledExtensions = getEnabledPaths(resolvedPaths.extensions);
  const enabledSkillResources = getEnabledResources(resolvedPaths.skills);
  const enabledPrompts = getEnabledPaths(resolvedPaths.prompts);
  const enabledThemes = getEnabledPaths(resolvedPaths.themes);

  const enabledSkills = enabledSkillResources.map((resource) => self.mapSkillPath(resource, metadataByPath));

  // Add CLI paths metadata
  for (const r of cliExtensionPaths.extensions) {
    if (!metadataByPath.has(r.path)) {
      metadataByPath.set(r.path, { source: "cli", scope: "temporary", origin: "top-level" });
    }
  }
  for (const r of cliExtensionPaths.skills) {
    if (!metadataByPath.has(r.path)) {
      metadataByPath.set(r.path, { source: "cli", scope: "temporary", origin: "top-level" });
    }
  }

  const cliEnabledExtensions = getEnabledPaths(cliExtensionPaths.extensions);
  const cliEnabledSkills = getEnabledPaths(cliExtensionPaths.skills);
  const cliEnabledPrompts = getEnabledPaths(cliExtensionPaths.prompts);
  const cliEnabledThemes = getEnabledPaths(cliExtensionPaths.themes);

  const extensionPaths = self.noExtensions
    ? cliEnabledExtensions
    : self.mergePaths(cliEnabledExtensions, enabledExtensions);

  const extensionsResult = await self.loadFinalExtensionSet(extensionPaths, preTrustExtensions);
  for (const p of self.additionalExtensionPaths) {
    if (isLocalPath(p)) {
      const resolved = self.resolveResourcePath(p);
      if (!existsSync(resolved)) {
        extensionsResult.errors.push({ path: resolved, error: `Extension path does not exist: ${resolved}` });
      }
    }
  }
  self.extensionsResult = self.extensionsOverride ? self.extensionsOverride(extensionsResult) : extensionsResult;
  self.applyExtensionSourceInfo(self.extensionsResult.extensions, metadataByPath);

  const skillPaths = self.noSkills
    ? self.mergePaths(cliEnabledSkills, self.additionalSkillPaths)
    : self.mergePaths([...cliEnabledSkills, ...enabledSkills], self.additionalSkillPaths);

  self.lastSkillPaths = skillPaths;
  self.updateSkillsFromPaths(skillPaths, metadataByPath);
  for (const p of self.additionalSkillPaths) {
    if (isLocalPath(p)) {
      const resolved = self.resolveResourcePath(p);
      if (!existsSync(resolved) && !self.skillDiagnostics.some((d) => d.path === resolved)) {
        self.skillDiagnostics.push({ type: "error", message: "Skill path does not exist", path: resolved });
      }
    }
  }

  const promptPaths = self.noPromptTemplates
    ? self.mergePaths(cliEnabledPrompts, self.additionalPromptTemplatePaths)
    : self.mergePaths([...cliEnabledPrompts, ...enabledPrompts], self.additionalPromptTemplatePaths);

  self.lastPromptPaths = promptPaths;
  self.updatePromptsFromPaths(promptPaths, metadataByPath);
  for (const p of self.additionalPromptTemplatePaths) {
    if (isLocalPath(p)) {
      const resolved = self.resolveResourcePath(p);
      if (!existsSync(resolved) && !self.promptDiagnostics.some((d) => d.path === resolved)) {
        self.promptDiagnostics.push({
          type: "error",
          message: "Prompt template path does not exist",
          path: resolved,
        });
      }
    }
  }

  const themePaths = self.noThemes
    ? self.mergePaths(cliEnabledThemes, self.additionalThemePaths)
    : self.mergePaths([...cliEnabledThemes, ...enabledThemes], self.additionalThemePaths);

  self.lastThemePaths = themePaths;
  self.updateThemesFromPaths(themePaths, metadataByPath);
  for (const p of self.additionalThemePaths) {
    const resolved = self.resolveResourcePath(p);
    if (!existsSync(resolved) && !self.themeDiagnostics.some((d) => d.path === resolved)) {
      self.themeDiagnostics.push({ type: "error", message: "Theme path does not exist", path: resolved });
    }
  }

  const agentsFiles = {
    agentsFiles: self.noContextFiles
      ? []
      : loadProjectContextFiles({
          cwd: self.cwd,
          agentDir: self.agentDir,
        }),
  };
  const resolvedAgentsFiles = self.agentsFilesOverride ? self.agentsFilesOverride(agentsFiles) : agentsFiles;
  self.agentsFiles = resolvedAgentsFiles.agentsFiles;

  const baseSystemPrompt = resolvePromptInput(
    self.systemPromptSource ?? self.discoverSystemPromptFile(),
    "system prompt",
  );
  self.systemPrompt = self.systemPromptOverride ? self.systemPromptOverride(baseSystemPrompt) : baseSystemPrompt;

  const appendSources =
    self.appendSystemPromptSource ??
    (self.discoverAppendSystemPromptFile() ? [self.discoverAppendSystemPromptFile()!] : []);
  const baseAppend = appendSources
    .map((s) => resolvePromptInput(s, "append system prompt"))
    .filter((s): s is string => s !== undefined);
  self.appendSystemPrompt = self.appendSystemPromptOverride ? self.appendSystemPromptOverride(baseAppend) : baseAppend;
}
