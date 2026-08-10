import { getAgentDir } from "../../config.ts";
import { type DelegatedMethods, installDelegatedMethods } from "../../utils/install-delegated-methods.ts";
import { deepMergeSettings } from "./helpers.ts";
import * as factoryDelegates from "./settingsmanager-methods/factory.ts";
import * as featureFlagsDelegates from "./settingsmanager-methods/feature-flags.ts";
import * as inputSettingsDelegates from "./settingsmanager-methods/input-settings.ts";
import * as persistenceDelegates from "./settingsmanager-methods/persistence.ts";
import * as projectTrustDelegates from "./settingsmanager-methods/project-trust.ts";
import * as reloadOverridesDelegates from "./settingsmanager-methods/reload-overrides.ts";
import * as storageLoadingDelegates from "./settingsmanager-methods/storage-loading.ts";
import * as transportSettingsDelegates from "./settingsmanager-methods/transport-settings.ts";
import * as uiSettingsDelegates from "./settingsmanager-methods/ui-settings.ts";
import type { Settings, SettingsError, SettingsManagerCreateOptions, SettingsScope, SettingsStorage } from "./types.ts";

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: The installer below synchronously defines every delegated method.
export class SettingsManager {
  public storage: SettingsStorage;

  public globalSettings: Settings;

  public projectSettings: Settings;

  public settings: Settings;

  public projectTrusted: boolean;

  public modifiedFields = new Set<keyof Settings>();

  public modifiedNestedFields = new Map<keyof Settings, Set<string>>();

  public modifiedProjectFields = new Set<keyof Settings>();

  public modifiedProjectNestedFields = new Map<keyof Settings, Set<string>>();

  public globalSettingsLoadError: Error | null = null;

  public projectSettingsLoadError: Error | null = null;

  public writeQueue: Promise<void> = Promise.resolve();

  public errors: SettingsError[];

  public constructor(
    storage: SettingsStorage,
    initialGlobal: Settings,
    initialProject: Settings,
    globalLoadError: Error | null = null,
    projectLoadError: Error | null = null,
    initialErrors: SettingsError[] = [],
    projectTrusted = true,
  ) {
    this.storage = storage;
    this.globalSettings = initialGlobal;
    this.projectSettings = initialProject;
    this.projectTrusted = projectTrusted;
    this.globalSettingsLoadError = globalLoadError;
    this.projectSettingsLoadError = projectLoadError;
    this.errors = [...initialErrors];
    this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);
  }

  static create(
    cwd: string,
    agentDir: string = getAgentDir(),
    options: SettingsManagerCreateOptions = {},
  ): SettingsManager {
    return factoryDelegates.do_create(cwd, agentDir, options);
  }

  static fromStorage(storage: SettingsStorage, options: SettingsManagerCreateOptions = {}): SettingsManager {
    return factoryDelegates.do_fromStorage(storage, options);
  }

  static inMemory(settings: Partial<Settings> = {}): SettingsManager {
    return factoryDelegates.do_inMemory(settings);
  }

  static loadFromStorage(storage: SettingsStorage, scope: SettingsScope, projectTrusted = true): Settings {
    return storageLoadingDelegates.do_loadFromStorage(storage, scope, projectTrusted);
  }

  static tryLoadFromStorage(
    storage: SettingsStorage,
    scope: SettingsScope,
    projectTrusted = true,
  ): { settings: Settings; error: Error | null } {
    return storageLoadingDelegates.do_tryLoadFromStorage(storage, scope, projectTrusted);
  }

  static migrateSettings(settings: Record<string, unknown>): Settings {
    return storageLoadingDelegates.do_migrateSettings(settings);
  }
}

type SettingsManagerMethods = DelegatedMethods<
  SettingsManager,
  typeof featureFlagsDelegates &
    typeof inputSettingsDelegates &
    typeof persistenceDelegates &
    typeof projectTrustDelegates &
    typeof reloadOverridesDelegates &
    typeof transportSettingsDelegates &
    typeof uiSettingsDelegates
>;

export interface SettingsManager extends SettingsManagerMethods {}

installDelegatedMethods(SettingsManager.prototype, [
  featureFlagsDelegates,
  inputSettingsDelegates,
  persistenceDelegates,
  projectTrustDelegates,
  reloadOverridesDelegates,
  transportSettingsDelegates,
  uiSettingsDelegates,
]);
