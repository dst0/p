import { Spacer, Text } from "@dst0/p-tui";
import type { ResourceDiagnostic } from "../../../../core/resource-loader.ts";
import type { SourceInfo } from "../../../../core/source-info.ts";
import { type ThemeColor, theme } from "../../theme/theme.ts";
import { ExpandableText } from "../expandabletext.ts";
import type { InteractiveMode } from "../interactivemode.ts";

export function do_showLoadedResources(
  self: InteractiveMode,
  options?: {
    extensions?: Array<{ path: string; sourceInfo?: SourceInfo }>;
    force?: boolean;
    showDiagnosticsWhenQuiet?: boolean;
  },
): void {
  const showListing = options?.force || self.options.verbose || !self.settingsManager.getQuietStartup();
  const showDiagnostics = showListing || options?.showDiagnosticsWhenQuiet === true;
  if (!showListing && !showDiagnostics) {
    return;
  }

  const sectionHeader = (name: string, color: ThemeColor = "mdHeading") => theme.fg(color, `[${name}]`);
  const formatCompactList = (items: string[], options?: { sort?: boolean }): string => {
    const labels = items.map((item) => item.trim()).filter((item) => item.length > 0);
    if (options?.sort !== false) {
      labels.sort((a, b) => a.localeCompare(b));
    }
    return theme.fg("dim", `  ${labels.join(", ")}`);
  };
  const addLoadedSection = (
    name: string,
    collapsedBody: string,
    expandedBody = collapsedBody,
    color: ThemeColor = "mdHeading",
  ): void => {
    const section = new ExpandableText(
      () => `${sectionHeader(name, color)}\n${collapsedBody}`,
      () => `${sectionHeader(name, color)}\n${expandedBody}`,
      self.getStartupExpansionState(),
      0,
      0,
    );
    self.chatContainer.addChild(section);
    self.chatContainer.addChild(new Spacer(1));
  };

  const skillsResult = self.session.resourceLoader.getSkills();
  const promptsResult = self.session.resourceLoader.getPrompts();
  const themesResult = self.session.resourceLoader.getThemes();
  const extensions =
    options?.extensions ??
    self.session.resourceLoader.getExtensions().extensions.map((extension) => ({
      path: extension.path,
      sourceInfo: extension.sourceInfo,
    }));
  const sourceInfos = new Map<string, SourceInfo>();
  for (const extension of extensions) {
    if (extension.sourceInfo) {
      sourceInfos.set(extension.path, extension.sourceInfo);
    }
  }
  for (const skill of skillsResult.skills) {
    if (skill.sourceInfo) {
      sourceInfos.set(skill.filePath, skill.sourceInfo);
    }
  }
  for (const prompt of promptsResult.prompts) {
    if (prompt.sourceInfo) {
      sourceInfos.set(prompt.filePath, prompt.sourceInfo);
    }
  }
  for (const loadedTheme of themesResult.themes) {
    if (loadedTheme.sourcePath && loadedTheme.sourceInfo) {
      sourceInfos.set(loadedTheme.sourcePath, loadedTheme.sourceInfo);
    }
  }

  if (showListing) {
    const contextFiles = self.session.resourceLoader.getAgentsFiles().agentsFiles;
    if (contextFiles.length > 0) {
      self.chatContainer.addChild(new Spacer(1));
      const contextList = contextFiles.map((f) => theme.fg("dim", `  ${self.formatDisplayPath(f.path)}`)).join("\n");
      const contextCompactList = formatCompactList(
        contextFiles.map((contextFile) => self.formatContextPath(contextFile.path)),
        { sort: false },
      );
      addLoadedSection("Context", contextCompactList, contextList);
    }

    const skills = skillsResult.skills;
    if (skills.length > 0) {
      const groups = self.buildScopeGroups(
        skills.map((skill) => ({
          path: skill.filePath,
          sourceInfo: skill.sourceInfo,
        })),
      );
      const skillList = self.formatScopeGroups(groups, {
        formatPath: (item) => self.formatDisplayPath(item.path),
        formatPackagePath: (item) => self.getShortPath(item.path, item.sourceInfo),
      });
      const skillCompactList = formatCompactList(skills.map((skill) => skill.name));
      addLoadedSection("Skills", skillCompactList, skillList);
    }

    const templates = self.session.promptTemplates;
    if (templates.length > 0) {
      const groups = self.buildScopeGroups(
        templates.map((template) => ({
          path: template.filePath,
          sourceInfo: template.sourceInfo,
        })),
      );
      const templateByPath = new Map(templates.map((t) => [t.filePath, t]));
      const templateList = self.formatScopeGroups(groups, {
        formatPath: (item) => {
          const template = templateByPath.get(item.path);
          return template ? `/${template.name}` : self.formatDisplayPath(item.path);
        },
        formatPackagePath: (item) => {
          const template = templateByPath.get(item.path);
          return template ? `/${template.name}` : self.formatDisplayPath(item.path);
        },
      });
      const promptCompactList = formatCompactList(templates.map((template) => `/${template.name}`));
      addLoadedSection("Prompts", promptCompactList, templateList);
    }

    if (extensions.length > 0) {
      const groups = self.buildScopeGroups(extensions);
      const extList = self.formatScopeGroups(groups, {
        formatPath: (item) => self.formatExtensionDisplayPath(item.path),
        formatPackagePath: (item) => self.formatExtensionDisplayPath(self.getShortPath(item.path, item.sourceInfo)),
      });
      const extensionCompactList = formatCompactList(self.getCompactExtensionLabels(extensions));
      addLoadedSection("Extensions", extensionCompactList, extList, "mdHeading");
    }

    // Show loaded themes (excluding built-in)
    const loadedThemes = themesResult.themes;
    const customThemes = loadedThemes.filter((t) => t.sourcePath);
    if (customThemes.length > 0) {
      const groups = self.buildScopeGroups(
        customThemes.map((loadedTheme) => ({
          path: loadedTheme.sourcePath!,
          sourceInfo: loadedTheme.sourceInfo,
        })),
      );
      const themeList = self.formatScopeGroups(groups, {
        formatPath: (item) => self.formatDisplayPath(item.path),
        formatPackagePath: (item) => self.getShortPath(item.path, item.sourceInfo),
      });
      const themeCompactList = formatCompactList(
        customThemes.map(
          (loadedTheme) =>
            loadedTheme.name ?? self.getCompactPathLabel(loadedTheme.sourcePath!, loadedTheme.sourceInfo),
        ),
      );
      addLoadedSection("Themes", themeCompactList, themeList);
    }
  }

  if (showDiagnostics) {
    const skillDiagnostics = skillsResult.diagnostics;
    if (skillDiagnostics.length > 0) {
      const warningLines = self.formatDiagnostics(skillDiagnostics, sourceInfos);
      self.chatContainer.addChild(new Text(`${theme.fg("warning", "[Skill conflicts]")}\n${warningLines}`, 0, 0));
      self.chatContainer.addChild(new Spacer(1));
    }

    const promptDiagnostics = promptsResult.diagnostics;
    if (promptDiagnostics.length > 0) {
      const warningLines = self.formatDiagnostics(promptDiagnostics, sourceInfos);
      self.chatContainer.addChild(new Text(`${theme.fg("warning", "[Prompt conflicts]")}\n${warningLines}`, 0, 0));
      self.chatContainer.addChild(new Spacer(1));
    }

    const extensionDiagnostics: ResourceDiagnostic[] = [];
    const extensionErrors = self.session.resourceLoader.getExtensions().errors;
    if (extensionErrors.length > 0) {
      for (const error of extensionErrors) {
        extensionDiagnostics.push({
          type: "error",
          message: error.error,
          path: error.path,
        });
      }
    }

    const commandDiagnostics = self.session.extensionRunner.getCommandDiagnostics();
    extensionDiagnostics.push(...commandDiagnostics);
    extensionDiagnostics.push(...self.getBuiltInCommandConflictDiagnostics(self.session.extensionRunner));

    const shortcutDiagnostics = self.session.extensionRunner.getShortcutDiagnostics();
    extensionDiagnostics.push(...shortcutDiagnostics);

    if (extensionDiagnostics.length > 0) {
      const warningLines = self.formatDiagnostics(extensionDiagnostics, sourceInfos);
      self.chatContainer.addChild(new Text(`${theme.fg("warning", "[Extension issues]")}\n${warningLines}`, 0, 0));
      self.chatContainer.addChild(new Spacer(1));
    }

    const themeDiagnostics = themesResult.diagnostics;
    if (themeDiagnostics.length > 0) {
      const warningLines = self.formatDiagnostics(themeDiagnostics, sourceInfos);
      self.chatContainer.addChild(new Text(`${theme.fg("warning", "[Theme conflicts]")}\n${warningLines}`, 0, 0));
      self.chatContainer.addChild(new Spacer(1));
    }
  }
}
