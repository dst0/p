import type { Theme } from "../../modes/interactive/theme/theme.ts";
import { type DelegatedMethods, installDelegatedMethods } from "../../utils/install-delegated-methods.ts";
import { resolvePath } from "../../utils/paths.ts";
import type { ResourceDiagnostic } from "../diagnostics.ts";
import { createEventBus, type EventBus } from "../event-bus.ts";
import { createExtensionRuntime } from "../extensions/loader.ts";
import type { ExtensionFactory, LoadExtensionsResult } from "../extensions/types.ts";
import { DefaultPackageManager } from "../package-manager.ts";
import type { PromptTemplate } from "../prompt-templates.ts";
import { SettingsManager } from "../settings-manager.ts";
import type { Skill } from "../skills.ts";
import type { SourceInfo } from "../source-info.ts";
import * as discoveryDelegates from "./defaultresourceloader-methods/discovery.ts";
import * as extensionLoadingDelegates from "./defaultresourceloader-methods/extension-loading.ts";
import * as gettersDelegates from "./defaultresourceloader-methods/getters.ts";
import * as pathResolutionDelegates from "./defaultresourceloader-methods/path-resolution.ts";
import * as promptThemePathsDelegates from "./defaultresourceloader-methods/prompt-theme-paths.ts";
import * as reloadDelegates from "./defaultresourceloader-methods/reload.ts";
import type { DefaultResourceLoaderOptions, ResourceLoader } from "./types.ts";

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: The installer below synchronously defines every delegated method.
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
}

type DefaultResourceLoaderMethods = DelegatedMethods<
  DefaultResourceLoader,
  typeof discoveryDelegates &
    typeof extensionLoadingDelegates &
    typeof gettersDelegates &
    typeof pathResolutionDelegates &
    typeof promptThemePathsDelegates &
    typeof reloadDelegates
>;

export interface DefaultResourceLoader extends DefaultResourceLoaderMethods {}

installDelegatedMethods(DefaultResourceLoader.prototype, [
  discoveryDelegates,
  extensionLoadingDelegates,
  gettersDelegates,
  pathResolutionDelegates,
  promptThemePathsDelegates,
  reloadDelegates,
]);
