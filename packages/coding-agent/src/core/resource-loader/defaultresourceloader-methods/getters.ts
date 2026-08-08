import type { Theme } from "../../../modes/interactive/theme/theme.ts";
import type { ResourceDiagnostic } from "../../diagnostics.ts";
import type { LoadExtensionsResult } from "../../extensions/types.ts";
import type { PromptTemplate } from "../../prompt-templates.ts";
import type { Skill } from "../../skills.ts";
import { createSourceInfo } from "../../source-info.ts";
import type { DefaultResourceLoader } from "../defaultresourceloader.ts";
import type { ResourceExtensionPaths } from "../types.ts";

export function do_getExtensions(self: DefaultResourceLoader): LoadExtensionsResult {
  return self.extensionsResult;
}

export function do_getSkills(self: DefaultResourceLoader): { skills: Skill[]; diagnostics: ResourceDiagnostic[] } {
  return { skills: self.skills, diagnostics: self.skillDiagnostics };
}

export function do_getPrompts(self: DefaultResourceLoader): {
  prompts: PromptTemplate[];
  diagnostics: ResourceDiagnostic[];
} {
  return { prompts: self.prompts, diagnostics: self.promptDiagnostics };
}

export function do_getThemes(self: DefaultResourceLoader): { themes: Theme[]; diagnostics: ResourceDiagnostic[] } {
  return { themes: self.themes, diagnostics: self.themeDiagnostics };
}

export function do_getAgentsFiles(self: DefaultResourceLoader): {
  agentsFiles: Array<{ path: string; content: string }>;
} {
  return { agentsFiles: self.agentsFiles };
}

export function do_getSystemPrompt(self: DefaultResourceLoader): string | undefined {
  return self.systemPrompt;
}

export function do_getAppendSystemPrompt(self: DefaultResourceLoader): string[] {
  return self.appendSystemPrompt;
}

export function do_extendResources(self: DefaultResourceLoader, paths: ResourceExtensionPaths): void {
  const skillPaths = self.normalizeExtensionPaths(paths.skillPaths ?? []);
  const promptPaths = self.normalizeExtensionPaths(paths.promptPaths ?? []);
  const themePaths = self.normalizeExtensionPaths(paths.themePaths ?? []);

  for (const entry of skillPaths) {
    self.extensionSkillSourceInfos.set(entry.path, createSourceInfo(entry.path, entry.metadata));
  }
  for (const entry of promptPaths) {
    self.extensionPromptSourceInfos.set(entry.path, createSourceInfo(entry.path, entry.metadata));
  }
  for (const entry of themePaths) {
    self.extensionThemeSourceInfos.set(entry.path, createSourceInfo(entry.path, entry.metadata));
  }

  if (skillPaths.length > 0) {
    self.lastSkillPaths = self.mergePaths(
      self.lastSkillPaths,
      skillPaths.map((entry) => entry.path),
    );
    self.updateSkillsFromPaths(self.lastSkillPaths);
  }

  if (promptPaths.length > 0) {
    self.lastPromptPaths = self.mergePaths(
      self.lastPromptPaths,
      promptPaths.map((entry) => entry.path),
    );
    self.updatePromptsFromPaths(self.lastPromptPaths);
  }

  if (themePaths.length > 0) {
    self.lastThemePaths = self.mergePaths(
      self.lastThemePaths,
      themePaths.map((entry) => entry.path),
    );
    self.updateThemesFromPaths(self.lastThemePaths);
  }
}

export async function do_loadProjectTrustExtensions(self: DefaultResourceLoader): Promise<LoadExtensionsResult> {
  // Force untrusted project settings for the bootstrap pass. This keeps project-local
  // extensions/packages out while still loading user/global and temporary CLI extensions.
  self.settingsManager.setProjectTrusted(false);
  await self.settingsManager.reload();
  return self.loadCurrentExtensionSet({ includeInlineFactories: true });
}
