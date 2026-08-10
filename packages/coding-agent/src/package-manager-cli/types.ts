import type { ExtensionFactory } from "../core/extensions/types.ts";
import type { SettingsManager } from "../core/settings-manager.ts";

export type PackageCommand = "install" | "remove" | "update" | "list";

export type UpdateTarget = { type: "all" } | { type: "self" } | { type: "extensions"; source?: string };

export interface PackageCommandOptions {
  command: PackageCommand;
  source?: string;
  updateTarget?: UpdateTarget;
  local: boolean;
  force: boolean;
  projectTrustOverride?: boolean;
  help: boolean;
  invalidOption?: string;
  invalidArgument?: string;
  missingOptionValue?: string;
  conflictingOptions?: string;
}

export interface SelfUpdatePlan {
  packageName: string;
  shouldRun: boolean;
  note?: string;
}

export interface PackageCommandRuntimeOptions {
  extensionFactories?: ExtensionFactory[];
}

export interface CommandSettingsResult {
  settingsManager: SettingsManager;
  projectTrustWarnings: string[];
}
