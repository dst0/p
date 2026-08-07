import type { Theme } from "../../modes/interactive/theme/theme.ts";
import { resolvePath } from "../../utils/paths.ts";
import type { ResourceDiagnostic } from "../diagnostics.ts";
import { createEventBus, type EventBus } from "../event-bus.ts";
import { createExtensionRuntime } from "../extensions/loader.ts";
import type { Extension, ExtensionFactory, ExtensionRuntime, LoadExtensionsResult } from "../extensions/types.ts";
import { DefaultPackageManager, type PathMetadata, type ResolvedResource } from "../package-manager.ts";
import type { PromptTemplate } from "../prompt-templates.ts";
import { SettingsManager } from "../settings-manager.ts";
import type { Skill } from "../skills.ts";
import type { SourceInfo } from "../source-info.ts";
import {
  do_extendResources,
  do_getAgentsFiles,
  do_getAppendSystemPrompt,
  do_getExtensions,
  do_getPrompts,
  do_getSkills,
  do_getSystemPrompt,
  do_getThemes,
  do_loadProjectTrustExtensions,
} from "./defaultresourceloader-methods/methods-part1.ts";
import { do_reload } from "./defaultresourceloader-methods/methods-part2.ts";
import {
  do_addExtensionConflictDiagnostics,
  do_loadCurrentExtensionSet,
  do_loadFinalExtensionSet,
  do_mapSkillPath,
  do_normalizeExtensionPaths,
  do_resolveExtensionLoadPath,
  do_updateSkillsFromPaths,
} from "./defaultresourceloader-methods/methods-part3.ts";
import {
  do_applyExtensionSourceInfo,
  do_findSourceInfoForPath,
  do_getDefaultSourceInfoForPath,
  do_updatePromptsFromPaths,
  do_updateThemesFromPaths,
} from "./defaultresourceloader-methods/methods-part4.ts";
import {
  do_dedupePrompts,
  do_loadExtensionFactories,
  do_loadThemeFromFile,
  do_loadThemes,
  do_loadThemesFromDir,
  do_mergePaths,
  do_resolveResourcePath,
} from "./defaultresourceloader-methods/methods-part5.ts";
import {
  do_dedupeThemes,
  do_detectExtensionConflicts,
  do_discoverAppendSystemPromptFile,
  do_discoverSystemPromptFile,
  do_isUnderPath,
} from "./defaultresourceloader-methods/methods-part6.ts";
import type {
  DefaultResourceLoaderOptions,
  ResourceExtensionPaths,
  ResourceLoader,
  ResourceLoaderReloadOptions,
} from "./types.ts";

export class DefaultResourceLoader implements ResourceLoader {
  public cwd: string;

  public agentDir: string;

  public settingsManager: SettingsManager;

  public eventBus: EventBus;

  public packageManager: DefaultPackageManager;

  public additionalExtensionPaths: string[];

  public additionalSkillPaths: string[];

  public additionalPromptTemplatePaths: string[];

  public additionalThemePaths: string[];

  public extensionFactories: ExtensionFactory[];

  public noExtensions: boolean;

  public noSkills: boolean;

  public noPromptTemplates: boolean;

  public noThemes: boolean;

  public noContextFiles: boolean;

  public systemPromptSource?: string;

  public appendSystemPromptSource?: string[];

  public extensionsOverride?: (base: LoadExtensionsResult) => LoadExtensionsResult;

  public skillsOverride?: (base: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }) => {
    skills: Skill[];
    diagnostics: ResourceDiagnostic[];
  };

  public promptsOverride?: (base: { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] }) => {
    prompts: PromptTemplate[];
    diagnostics: ResourceDiagnostic[];
  };

  public themesOverride?: (base: { themes: Theme[]; diagnostics: ResourceDiagnostic[] }) => {
    themes: Theme[];
    diagnostics: ResourceDiagnostic[];
  };

  public agentsFilesOverride?: (base: { agentsFiles: Array<{ path: string; content: string }> }) => {
    agentsFiles: Array<{ path: string; content: string }>;
  };

  public systemPromptOverride?: (base: string | undefined) => string | undefined;

  public appendSystemPromptOverride?: (base: string[]) => string[];

  public extensionsResult: LoadExtensionsResult;

  public skills: Skill[];

  public skillDiagnostics: ResourceDiagnostic[];

  public prompts: PromptTemplate[];

  public promptDiagnostics: ResourceDiagnostic[];

  public themes: Theme[];

  public themeDiagnostics: ResourceDiagnostic[];

  public agentsFiles: Array<{ path: string; content: string }>;

  public systemPrompt?: string;

  public appendSystemPrompt: string[];

  public lastSkillPaths: string[];

  public extensionSkillSourceInfos: Map<string, SourceInfo>;

  public extensionPromptSourceInfos: Map<string, SourceInfo>;

  public extensionThemeSourceInfos: Map<string, SourceInfo>;

  public lastPromptPaths: string[];

  public lastThemePaths: string[];

  constructor(options: DefaultResourceLoaderOptions) {
    this.cwd = resolvePath(options.cwd);
    this.agentDir = resolvePath(options.agentDir);
    this.settingsManager = options.settingsManager ?? SettingsManager.create(this.cwd, this.agentDir);
    this.eventBus = options.eventBus ?? createEventBus();
    this.packageManager = new DefaultPackageManager({
      cwd: this.cwd,
      agentDir: this.agentDir,
      settingsManager: this.settingsManager,
    });
    this.additionalExtensionPaths = options.additionalExtensionPaths ?? [];
    this.additionalSkillPaths = options.additionalSkillPaths ?? [];
    this.additionalPromptTemplatePaths = options.additionalPromptTemplatePaths ?? [];
    this.additionalThemePaths = options.additionalThemePaths ?? [];
    this.extensionFactories = options.extensionFactories ?? [];
    this.noExtensions = options.noExtensions ?? false;
    this.noSkills = options.noSkills ?? false;
    this.noPromptTemplates = options.noPromptTemplates ?? false;
    this.noThemes = options.noThemes ?? false;
    this.noContextFiles = options.noContextFiles ?? false;
    this.systemPromptSource = options.systemPrompt;
    this.appendSystemPromptSource = options.appendSystemPrompt;
    this.extensionsOverride = options.extensionsOverride;
    this.skillsOverride = options.skillsOverride;
    this.promptsOverride = options.promptsOverride;
    this.themesOverride = options.themesOverride;
    this.agentsFilesOverride = options.agentsFilesOverride;
    this.systemPromptOverride = options.systemPromptOverride;
    this.appendSystemPromptOverride = options.appendSystemPromptOverride;

    this.extensionsResult = { extensions: [], errors: [], runtime: createExtensionRuntime() };
    this.skills = [];
    this.skillDiagnostics = [];
    this.prompts = [];
    this.promptDiagnostics = [];
    this.themes = [];
    this.themeDiagnostics = [];
    this.agentsFiles = [];
    this.appendSystemPrompt = [];
    this.lastSkillPaths = [];
    this.extensionSkillSourceInfos = new Map();
    this.extensionPromptSourceInfos = new Map();
    this.extensionThemeSourceInfos = new Map();
    this.lastPromptPaths = [];
    this.lastThemePaths = [];
  }

  getExtensions(): LoadExtensionsResult {
    return do_getExtensions(this);
  }

  getSkills(): { skills: Skill[]; diagnostics: ResourceDiagnostic[] } {
    return do_getSkills(this);
  }

  getPrompts(): { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] } {
    return do_getPrompts(this);
  }

  getThemes(): { themes: Theme[]; diagnostics: ResourceDiagnostic[] } {
    return do_getThemes(this);
  }

  getAgentsFiles(): { agentsFiles: Array<{ path: string; content: string }> } {
    return do_getAgentsFiles(this);
  }

  getSystemPrompt(): string | undefined {
    return do_getSystemPrompt(this);
  }

  getAppendSystemPrompt(): string[] {
    return do_getAppendSystemPrompt(this);
  }

  extendResources(paths: ResourceExtensionPaths): void {
    do_extendResources(this, paths);
  }

  async loadProjectTrustExtensions(): Promise<LoadExtensionsResult> {
    return do_loadProjectTrustExtensions(this);
  }

  async reload(options?: ResourceLoaderReloadOptions): Promise<void> {
    return do_reload(this, options);
  }

  async loadCurrentExtensionSet(options: { includeInlineFactories: boolean }): Promise<LoadExtensionsResult> {
    return do_loadCurrentExtensionSet(this, options);
  }

  resolveExtensionLoadPath(path: string): string {
    return do_resolveExtensionLoadPath(this, path);
  }

  async loadFinalExtensionSet(
    extensionPaths: string[],
    preTrustExtensions: LoadExtensionsResult | undefined,
  ): Promise<LoadExtensionsResult> {
    return do_loadFinalExtensionSet(this, extensionPaths, preTrustExtensions);
  }

  addExtensionConflictDiagnostics(extensionsResult: LoadExtensionsResult): void {
    do_addExtensionConflictDiagnostics(this, extensionsResult);
  }

  mapSkillPath(resource: ResolvedResource, metadataByPath: Map<string, PathMetadata>): string {
    return do_mapSkillPath(this, resource, metadataByPath);
  }

  normalizeExtensionPaths(
    entries: Array<{ path: string; metadata: PathMetadata }>,
  ): Array<{ path: string; metadata: PathMetadata }> {
    return do_normalizeExtensionPaths(this, entries);
  }

  updateSkillsFromPaths(skillPaths: string[], metadataByPath?: Map<string, PathMetadata>): void {
    do_updateSkillsFromPaths(this, skillPaths, metadataByPath);
  }

  updatePromptsFromPaths(promptPaths: string[], metadataByPath?: Map<string, PathMetadata>): void {
    do_updatePromptsFromPaths(this, promptPaths, metadataByPath);
  }

  updateThemesFromPaths(themePaths: string[], metadataByPath?: Map<string, PathMetadata>): void {
    do_updateThemesFromPaths(this, themePaths, metadataByPath);
  }

  applyExtensionSourceInfo(extensions: Extension[], metadataByPath: Map<string, PathMetadata>): void {
    do_applyExtensionSourceInfo(this, extensions, metadataByPath);
  }

  findSourceInfoForPath(
    resourcePath: string,
    extraSourceInfos?: Map<string, SourceInfo>,
    metadataByPath?: Map<string, PathMetadata>,
  ): SourceInfo | undefined {
    return do_findSourceInfoForPath(this, resourcePath, extraSourceInfos, metadataByPath);
  }

  getDefaultSourceInfoForPath(filePath: string): SourceInfo {
    return do_getDefaultSourceInfoForPath(this, filePath);
  }

  mergePaths(primary: string[], additional: string[]): string[] {
    return do_mergePaths(this, primary, additional);
  }

  resolveResourcePath(p: string): string {
    return do_resolveResourcePath(this, p);
  }

  loadThemes(
    paths: string[],
    includeDefaults: boolean = true,
  ): {
    themes: Theme[];
    diagnostics: ResourceDiagnostic[];
  } {
    return do_loadThemes(this, paths, includeDefaults);
  }

  loadThemesFromDir(dir: string, themes: Theme[], diagnostics: ResourceDiagnostic[]): void {
    do_loadThemesFromDir(this, dir, themes, diagnostics);
  }

  loadThemeFromFile(filePath: string, themes: Theme[], diagnostics: ResourceDiagnostic[]): void {
    do_loadThemeFromFile(this, filePath, themes, diagnostics);
  }

  async loadExtensionFactories(runtime: ExtensionRuntime): Promise<{
    extensions: Extension[];
    errors: Array<{ path: string; error: string }>;
  }> {
    return do_loadExtensionFactories(this, runtime);
  }

  dedupePrompts(prompts: PromptTemplate[]): { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] } {
    return do_dedupePrompts(this, prompts);
  }

  dedupeThemes(themes: Theme[]): { themes: Theme[]; diagnostics: ResourceDiagnostic[] } {
    return do_dedupeThemes(this, themes);
  }

  discoverSystemPromptFile(): string | undefined {
    return do_discoverSystemPromptFile(this);
  }

  discoverAppendSystemPromptFile(): string | undefined {
    return do_discoverAppendSystemPromptFile(this);
  }

  isUnderPath(target: string, root: string): boolean {
    return do_isUnderPath(this, target, root);
  }

  detectExtensionConflicts(extensions: Extension[]): Array<{ path: string; message: string }> {
    return do_detectExtensionConflicts(this, extensions);
  }
}
