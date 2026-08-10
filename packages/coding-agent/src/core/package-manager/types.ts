import type ignore from "ignore";
import type { GitSource } from "../../utils/git.ts";
import type { SettingsManager } from "../settings-manager.ts";

export interface PathMetadata {
  source: string;
  scope: SourceScope;
  origin: "package" | "top-level";
  baseDir?: string;
}

export interface ResolvedResource {
  path: string;
  enabled: boolean;
  metadata: PathMetadata;
}

export interface ResolvedPaths {
  extensions: ResolvedResource[];
  skills: ResolvedResource[];
  prompts: ResolvedResource[];
  themes: ResolvedResource[];
}

export type MissingSourceAction = "install" | "skip" | "error";

export interface ProgressEvent {
  type: "start" | "progress" | "complete" | "error";
  action: "install" | "remove" | "update" | "clone" | "pull";
  source: string;
  message?: string;
}

export type ProgressCallback = (event: ProgressEvent) => void;

export interface PackageUpdate {
  source: string;
  displayName: string;
  type: "npm" | "git";
  scope: Exclude<SourceScope, "temporary">;
}

export interface ConfiguredPackage {
  source: string;
  scope: "user" | "project";
  filtered: boolean;
  installedPath?: string;
}

export interface PackageManager {
  resolve(onMissing?: (source: string) => Promise<MissingSourceAction>): Promise<ResolvedPaths>;
  install(source: string, options?: { local?: boolean }): Promise<void>;
  installAndPersist(source: string, options?: { local?: boolean }): Promise<void>;
  remove(source: string, options?: { local?: boolean }): Promise<void>;
  removeAndPersist(source: string, options?: { local?: boolean }): Promise<boolean>;
  update(source?: string): Promise<void>;
  listConfiguredPackages(): ConfiguredPackage[];
  resolveExtensionSources(
    sources: string[],
    options?: { local?: boolean; temporary?: boolean },
  ): Promise<ResolvedPaths>;
  addSourceToSettings(source: string, options?: { local?: boolean }): boolean;
  removeSourceFromSettings(source: string, options?: { local?: boolean }): boolean;
  setProgressCallback(callback: ProgressCallback | undefined): void;
  getInstalledPath(source: string, scope: "user" | "project"): string | undefined;
}

export interface PackageManagerOptions {
  cwd: string;
  agentDir: string;
  settingsManager: SettingsManager;
}

export type SourceScope = "user" | "project" | "temporary";

export type NpmSource = {
  type: "npm";
  spec: string;
  name: string;
  version?: string;
  range?: string;
  pinned: boolean;
};

export type LocalSource = {
  type: "local";
  path: string;
};

export type ParsedSource = NpmSource | GitSource | LocalSource;

export type InstalledSourceScope = Exclude<SourceScope, "temporary">;

export interface ConfiguredUpdateSource {
  source: string;
  scope: InstalledSourceScope;
}

export interface NpmUpdateTarget extends ConfiguredUpdateSource {
  parsed: NpmSource;
}

export interface GitUpdateTarget extends ConfiguredUpdateSource {
  parsed: GitSource;
}

export interface PiManifest {
  extensions?: string[];
  skills?: string[];
  prompts?: string[];
  themes?: string[];
}

export interface ResourceAccumulator {
  extensions: Map<string, { metadata: PathMetadata; enabled: boolean }>;
  skills: Map<string, { metadata: PathMetadata; enabled: boolean }>;
  prompts: Map<string, { metadata: PathMetadata; enabled: boolean }>;
  themes: Map<string, { metadata: PathMetadata; enabled: boolean }>;
}

export interface PackageFilter {
  extensions?: string[];
  skills?: string[];
  prompts?: string[];
  themes?: string[];
}

export type ResourceType = "extensions" | "skills" | "prompts" | "themes";

export type IgnoreMatcher = ReturnType<typeof ignore>;

export type SkillDiscoveryMode = "p" | "agents";
