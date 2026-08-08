import { statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { CONFIG_DIR_NAME } from "../../../config.ts";
import type { Theme } from "../../../modes/interactive/theme/theme.ts";
import type { ResourceDiagnostic } from "../../diagnostics.ts";
import type { Extension } from "../../extensions/types.ts";
import type { PathMetadata } from "../../package-manager.ts";
import type { PromptTemplate } from "../../prompt-templates.ts";
import { loadPromptTemplates } from "../../prompt-templates.ts";
import { createSourceInfo, type SourceInfo } from "../../source-info.ts";
import type { DefaultResourceLoader } from "../defaultresourceloader.ts";

export function do_updatePromptsFromPaths(
  self: DefaultResourceLoader,
  promptPaths: string[],
  metadataByPath?: Map<string, PathMetadata>,
): void {
  let promptsResult: { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] };
  if (self.noPromptTemplates && promptPaths.length === 0) {
    promptsResult = { prompts: [], diagnostics: [] };
  } else {
    const allPrompts = loadPromptTemplates({
      cwd: self.cwd,
      agentDir: self.agentDir,
      promptPaths,
      includeDefaults: false,
    });
    promptsResult = self.dedupePrompts(allPrompts);
  }
  const resolvedPrompts = self.promptsOverride ? self.promptsOverride(promptsResult) : promptsResult;
  self.prompts = resolvedPrompts.prompts.map((prompt) => ({
    ...prompt,
    sourceInfo:
      self.findSourceInfoForPath(prompt.filePath, self.extensionPromptSourceInfos, metadataByPath) ??
      prompt.sourceInfo ??
      self.getDefaultSourceInfoForPath(prompt.filePath),
  }));
  self.promptDiagnostics = resolvedPrompts.diagnostics;
}

export function do_updateThemesFromPaths(
  self: DefaultResourceLoader,
  themePaths: string[],
  metadataByPath?: Map<string, PathMetadata>,
): void {
  let themesResult: { themes: Theme[]; diagnostics: ResourceDiagnostic[] };
  if (self.noThemes && themePaths.length === 0) {
    themesResult = { themes: [], diagnostics: [] };
  } else {
    const loaded = self.loadThemes(themePaths, false);
    const deduped = self.dedupeThemes(loaded.themes);
    themesResult = { themes: deduped.themes, diagnostics: [...loaded.diagnostics, ...deduped.diagnostics] };
  }
  const resolvedThemes = self.themesOverride ? self.themesOverride(themesResult) : themesResult;
  self.themes = resolvedThemes.themes.map((theme) => {
    const sourcePath = theme.sourcePath;
    theme.sourceInfo = sourcePath
      ? (self.findSourceInfoForPath(sourcePath, self.extensionThemeSourceInfos, metadataByPath) ??
        theme.sourceInfo ??
        self.getDefaultSourceInfoForPath(sourcePath))
      : theme.sourceInfo;
    return theme;
  });
  self.themeDiagnostics = resolvedThemes.diagnostics;
}

export function do_applyExtensionSourceInfo(
  self: DefaultResourceLoader,
  extensions: Extension[],
  metadataByPath: Map<string, PathMetadata>,
): void {
  for (const extension of extensions) {
    extension.sourceInfo =
      self.findSourceInfoForPath(extension.path, undefined, metadataByPath) ??
      self.getDefaultSourceInfoForPath(extension.path);
    for (const command of extension.commands.values()) {
      command.sourceInfo = extension.sourceInfo;
    }
    for (const tool of extension.tools.values()) {
      tool.sourceInfo = extension.sourceInfo;
    }
  }
}

export function do_findSourceInfoForPath(
  self: DefaultResourceLoader,
  resourcePath: string,
  extraSourceInfos?: Map<string, SourceInfo>,
  metadataByPath?: Map<string, PathMetadata>,
): SourceInfo | undefined {
  if (!resourcePath) {
    return undefined;
  }

  if (resourcePath.startsWith("<")) {
    return self.getDefaultSourceInfoForPath(resourcePath);
  }

  const normalizedResourcePath = resolve(resourcePath);
  if (extraSourceInfos) {
    for (const [sourcePath, sourceInfo] of extraSourceInfos.entries()) {
      const normalizedSourcePath = resolve(sourcePath);
      if (
        normalizedResourcePath === normalizedSourcePath ||
        normalizedResourcePath.startsWith(`${normalizedSourcePath}${sep}`)
      ) {
        return { ...sourceInfo, path: resourcePath };
      }
    }
  }

  if (metadataByPath) {
    const exact = metadataByPath.get(normalizedResourcePath) ?? metadataByPath.get(resourcePath);
    if (exact) {
      return createSourceInfo(resourcePath, exact);
    }

    for (const [sourcePath, metadata] of metadataByPath.entries()) {
      const normalizedSourcePath = resolve(sourcePath);
      if (
        normalizedResourcePath === normalizedSourcePath ||
        normalizedResourcePath.startsWith(`${normalizedSourcePath}${sep}`)
      ) {
        return createSourceInfo(resourcePath, metadata);
      }
    }
  }

  return undefined;
}

export function do_getDefaultSourceInfoForPath(self: DefaultResourceLoader, filePath: string): SourceInfo {
  if (filePath.startsWith("<") && filePath.endsWith(">")) {
    return {
      path: filePath,
      source: filePath.slice(1, -1).split(":")[0] || "temporary",
      scope: "temporary",
      origin: "top-level",
    };
  }

  const normalizedPath = resolve(filePath);
  const agentRoots = [
    join(self.agentDir, "skills"),
    join(self.agentDir, "prompts"),
    join(self.agentDir, "themes"),
    join(self.agentDir, "extensions"),
  ];
  const projectRoots = [
    join(self.cwd, CONFIG_DIR_NAME, "skills"),
    join(self.cwd, CONFIG_DIR_NAME, "prompts"),
    join(self.cwd, CONFIG_DIR_NAME, "themes"),
    join(self.cwd, CONFIG_DIR_NAME, "extensions"),
  ];

  for (const root of agentRoots) {
    if (self.isUnderPath(normalizedPath, root)) {
      return { path: filePath, source: "local", scope: "user", origin: "top-level", baseDir: root };
    }
  }

  for (const root of projectRoots) {
    if (self.isUnderPath(normalizedPath, root)) {
      return { path: filePath, source: "local", scope: "project", origin: "top-level", baseDir: root };
    }
  }

  return {
    path: filePath,
    source: "local",
    scope: "temporary",
    origin: "top-level",
    baseDir: statSync(normalizedPath).isDirectory() ? normalizedPath : resolve(normalizedPath, ".."),
  };
}
