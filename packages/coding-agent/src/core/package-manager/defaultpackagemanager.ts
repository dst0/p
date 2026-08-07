import type { ChildProcess, ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import type { GitSource } from "../../utils/git.ts";
import { resolvePath } from "../../utils/paths.ts";
import type { PackageSource, SettingsManager } from "../settings-manager.ts";
import {
  do_addSourceToSettings,
  do_emitProgress,
  do_getInstalledPath,
  do_removeSourceFromSettings,
  do_resolve,
  do_resolveExtensionSources,
  do_setProgressCallback,
  do_withProgress,
} from "./defaultpackagemanager-methods/methods-part1.ts";
import {
  do_install,
  do_installAndPersist,
  do_listConfiguredPackages,
  do_remove,
  do_removeAndPersist,
  do_update,
} from "./defaultpackagemanager-methods/methods-part2.ts";
import {
  do_installNpmBatch,
  do_shouldUpdateNpmSource,
  do_updateConfiguredSources,
  do_updateNpmBatch,
} from "./defaultpackagemanager-methods/methods-part3.ts";
import {
  do_checkForAvailableUpdates,
  do_resolveLocalExtensionSource,
  do_resolvePackageSources,
} from "./defaultpackagemanager-methods/methods-part4.ts";
import {
  do_buildNoMatchingPackageMessage,
  do_findSuggestedConfiguredSource,
  do_getInstalledNpmVersion,
  do_getPackageSourceString,
  do_getSourceMatchKeyForInput,
  do_getSourceMatchKeyForSettings,
  do_installedNpmMatchesConfiguredVersion,
  do_installParsedSource,
  do_normalizePackageSourceForSettings,
  do_npmHasAvailableUpdate,
  do_packageSourcesMatch,
  do_parseSource,
} from "./defaultpackagemanager-methods/methods-part5.ts";
import {
  do_getGitUpstreamRef,
  do_getLatestNpmVersion,
  do_getLocalGitUpdateTarget,
  do_getRemoteGitHead,
  do_gitHasAvailableUpdate,
  do_runGitRemoteCommand,
  do_runWithConcurrency,
} from "./defaultpackagemanager-methods/methods-part6.ts";
import {
  do_assertProjectTrustedForScope,
  do_dedupePackages,
  do_getGitDependencyInstallArgs,
  do_getNpmCommand,
  do_getNpmInstallArgs,
  do_getPackageIdentity,
  do_getPackageManagerName,
  do_installGit,
  do_installNpm,
  do_parseNpmSpec,
  do_runNpmCommand,
  do_runNpmCommandSync,
  do_uninstallNpm,
} from "./defaultpackagemanager-methods/methods-part7.ts";
import {
  do_ensureGitIgnore,
  do_ensureGitRef,
  do_ensureNpmProject,
  do_getGlobalNpmRoot,
  do_getManagedNpmInstallPath,
  do_getNpmInstallRoot,
  do_getPnpmGlobalPackagePath,
  do_pruneEmptyGitParents,
  do_refreshTemporaryGitSource,
  do_removeGit,
  do_updateGit,
} from "./defaultpackagemanager-methods/methods-part8.ts";
import {
  do_applyPackageFilter,
  do_collectDefaultResources,
  do_collectPackageResources,
  do_getBaseDirForScope,
  do_getGitInstallPath,
  do_getGitInstallRoot,
  do_getLegacyGlobalNpmInstallPath,
  do_getNpmInstallPath,
  do_getTemporaryDir,
  do_resolveManagedPath,
  do_resolvePath,
  do_resolvePathFromBase,
} from "./defaultpackagemanager-methods/methods-part9.ts";
import {
  do_addManifestEntries,
  do_collectFilesFromManifestEntries,
  do_collectManifestFiles,
  do_readPiManifest,
  do_resolveLocalEntries,
} from "./defaultpackagemanager-methods/methods-part10.ts";
import { do_addAutoDiscoveredResources } from "./defaultpackagemanager-methods/methods-part11.ts";
import {
  do_addResource,
  do_collectFilesFromPaths,
  do_createAccumulator,
  do_getTargetMap,
  do_runCommand,
  do_runCommandCapture,
  do_spawnCaptureCommand,
  do_spawnCommand,
  do_toResolvedPaths,
} from "./defaultpackagemanager-methods/methods-part12.ts";
import { do_runCommandSync } from "./defaultpackagemanager-methods/methods-part13.ts";
import type {
  ConfiguredPackage,
  ConfiguredUpdateSource,
  InstalledSourceScope,
  LocalSource,
  MissingSourceAction,
  NpmSource,
  NpmUpdateTarget,
  PackageFilter,
  PackageManager,
  PackageManagerOptions,
  PackageUpdate,
  ParsedSource,
  PathMetadata,
  PiManifest,
  ProgressCallback,
  ProgressEvent,
  ResolvedPaths,
  ResourceAccumulator,
  ResourceType,
  SourceScope,
} from "./types-part1.ts";

export class DefaultPackageManager implements PackageManager {
  public cwd: string;

  public agentDir: string;

  public settingsManager: SettingsManager;

  public globalNpmRoot: string | undefined;

  public globalNpmRootCommandKey: string | undefined;

  public progressCallback: ProgressCallback | undefined;

  constructor(options: PackageManagerOptions) {
    this.cwd = resolvePath(options.cwd);
    this.agentDir = resolvePath(options.agentDir);
    this.settingsManager = options.settingsManager;
  }

  setProgressCallback(callback: ProgressCallback | undefined): void {
    do_setProgressCallback(this, callback);
  }

  addSourceToSettings(source: string, options?: { local?: boolean }): boolean {
    return do_addSourceToSettings(this, source, options);
  }

  removeSourceFromSettings(source: string, options?: { local?: boolean }): boolean {
    return do_removeSourceFromSettings(this, source, options);
  }

  getInstalledPath(source: string, scope: "user" | "project"): string | undefined {
    return do_getInstalledPath(this, source, scope);
  }

  emitProgress(event: ProgressEvent): void {
    do_emitProgress(this, event);
  }

  async withProgress(
    action: ProgressEvent["action"],
    source: string,
    message: string,
    operation: () => Promise<void>,
  ): Promise<void> {
    return do_withProgress(this, action, source, message, operation);
  }

  async resolve(onMissing?: (source: string) => Promise<MissingSourceAction>): Promise<ResolvedPaths> {
    return do_resolve(this, onMissing);
  }

  async resolveExtensionSources(
    sources: string[],
    options?: { local?: boolean; temporary?: boolean },
  ): Promise<ResolvedPaths> {
    return do_resolveExtensionSources(this, sources, options);
  }

  listConfiguredPackages(): ConfiguredPackage[] {
    return do_listConfiguredPackages(this);
  }

  async install(source: string, options?: { local?: boolean }): Promise<void> {
    return do_install(this, source, options);
  }

  async installAndPersist(source: string, options?: { local?: boolean }): Promise<void> {
    return do_installAndPersist(this, source, options);
  }

  async remove(source: string, options?: { local?: boolean }): Promise<void> {
    return do_remove(this, source, options);
  }

  async removeAndPersist(source: string, options?: { local?: boolean }): Promise<boolean> {
    return do_removeAndPersist(this, source, options);
  }

  async update(source?: string): Promise<void> {
    return do_update(this, source);
  }

  async updateConfiguredSources(sources: ConfiguredUpdateSource[]): Promise<void> {
    return do_updateConfiguredSources(this, sources);
  }

  async shouldUpdateNpmSource(source: NpmSource, scope: InstalledSourceScope): Promise<boolean> {
    return do_shouldUpdateNpmSource(this, source, scope);
  }

  async updateNpmBatch(sources: NpmUpdateTarget[], scope: InstalledSourceScope): Promise<void> {
    return do_updateNpmBatch(this, sources, scope);
  }

  async installNpmBatch(specs: string[], scope: InstalledSourceScope): Promise<void> {
    return do_installNpmBatch(this, specs, scope);
  }

  async checkForAvailableUpdates(): Promise<PackageUpdate[]> {
    return do_checkForAvailableUpdates(this);
  }

  async resolvePackageSources(
    sources: Array<{ pkg: PackageSource; scope: SourceScope }>,
    accumulator: ResourceAccumulator,
    onMissing?: (source: string) => Promise<MissingSourceAction>,
  ): Promise<void> {
    return do_resolvePackageSources(this, sources, accumulator, onMissing);
  }

  resolveLocalExtensionSource(
    source: LocalSource,
    accumulator: ResourceAccumulator,
    filter: PackageFilter | undefined,
    metadata: PathMetadata,
    baseDir: string,
  ): void {
    do_resolveLocalExtensionSource(this, source, accumulator, filter, metadata, baseDir);
  }

  async installParsedSource(parsed: ParsedSource, scope: SourceScope): Promise<void> {
    return do_installParsedSource(this, parsed, scope);
  }

  getPackageSourceString(pkg: PackageSource): string {
    return do_getPackageSourceString(this, pkg);
  }

  getSourceMatchKeyForInput(source: string): string {
    return do_getSourceMatchKeyForInput(this, source);
  }

  getSourceMatchKeyForSettings(source: string, scope: SourceScope): string {
    return do_getSourceMatchKeyForSettings(this, source, scope);
  }

  buildNoMatchingPackageMessage(source: string, configuredPackages: PackageSource[]): string {
    return do_buildNoMatchingPackageMessage(this, source, configuredPackages);
  }

  findSuggestedConfiguredSource(source: string, configuredPackages: PackageSource[]): string | undefined {
    return do_findSuggestedConfiguredSource(this, source, configuredPackages);
  }

  packageSourcesMatch(existing: PackageSource, inputSource: string, scope: SourceScope): boolean {
    return do_packageSourcesMatch(this, existing, inputSource, scope);
  }

  normalizePackageSourceForSettings(source: string, scope: SourceScope): string {
    return do_normalizePackageSourceForSettings(this, source, scope);
  }

  parseSource(source: string): ParsedSource {
    return do_parseSource(this, source);
  }

  async installedNpmMatchesConfiguredVersion(source: NpmSource, installedPath: string): Promise<boolean> {
    return do_installedNpmMatchesConfiguredVersion(this, source, installedPath);
  }

  async npmHasAvailableUpdate(source: NpmSource, installedPath: string): Promise<boolean> {
    return do_npmHasAvailableUpdate(this, source, installedPath);
  }

  getInstalledNpmVersion(installedPath: string): string | undefined {
    return do_getInstalledNpmVersion(this, installedPath);
  }

  async getLatestNpmVersion(packageSpec: string, range?: string): Promise<string> {
    return do_getLatestNpmVersion(this, packageSpec, range);
  }

  async gitHasAvailableUpdate(installedPath: string): Promise<boolean> {
    return do_gitHasAvailableUpdate(this, installedPath);
  }

  async getRemoteGitHead(installedPath: string): Promise<string> {
    return do_getRemoteGitHead(this, installedPath);
  }

  async getLocalGitUpdateTarget(installedPath: string): Promise<{ ref: string; head: string; fetchArgs: string[] }> {
    return do_getLocalGitUpdateTarget(this, installedPath);
  }

  async getGitUpstreamRef(installedPath: string): Promise<string | undefined> {
    return do_getGitUpstreamRef(this, installedPath);
  }

  runGitRemoteCommand(installedPath: string, args: string[]): Promise<string> {
    return do_runGitRemoteCommand(this, installedPath, args);
  }

  async runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
    return do_runWithConcurrency(this, tasks, limit);
  }

  getPackageIdentity(source: string, scope?: SourceScope): string {
    return do_getPackageIdentity(this, source, scope);
  }

  dedupePackages(
    packages: Array<{ pkg: PackageSource; scope: SourceScope }>,
  ): Array<{ pkg: PackageSource; scope: SourceScope }> {
    return do_dedupePackages(this, packages);
  }

  parseNpmSpec(spec: string): { name: string; version?: string } {
    return do_parseNpmSpec(this, spec);
  }

  assertProjectTrustedForScope(scope: SourceScope): void {
    do_assertProjectTrustedForScope(this, scope);
  }

  getNpmCommand(): { command: string; args: string[] } {
    return do_getNpmCommand(this);
  }

  getPackageManagerName(): string {
    return do_getPackageManagerName(this);
  }

  async runNpmCommand(args: string[], options?: { cwd?: string }): Promise<void> {
    return do_runNpmCommand(this, args, options);
  }

  getGitDependencyInstallArgs(): string[] {
    return do_getGitDependencyInstallArgs(this);
  }

  runNpmCommandSync(args: string[]): string {
    return do_runNpmCommandSync(this, args);
  }

  getNpmInstallArgs(specs: string[], installRoot: string): string[] {
    return do_getNpmInstallArgs(this, specs, installRoot);
  }

  async installNpm(source: NpmSource, scope: SourceScope, temporary: boolean): Promise<void> {
    return do_installNpm(this, source, scope, temporary);
  }

  async uninstallNpm(source: NpmSource, scope: SourceScope): Promise<void> {
    return do_uninstallNpm(this, source, scope);
  }

  async installGit(source: GitSource, scope: SourceScope): Promise<void> {
    return do_installGit(this, source, scope);
  }

  async updateGit(source: GitSource, scope: SourceScope): Promise<void> {
    return do_updateGit(this, source, scope);
  }

  async ensureGitRef(targetDir: string, fetchArgs: string[], ref: string): Promise<void> {
    return do_ensureGitRef(this, targetDir, fetchArgs, ref);
  }

  async refreshTemporaryGitSource(source: GitSource, sourceStr: string): Promise<void> {
    return do_refreshTemporaryGitSource(this, source, sourceStr);
  }

  async removeGit(source: GitSource, scope: SourceScope): Promise<void> {
    return do_removeGit(this, source, scope);
  }

  pruneEmptyGitParents(targetDir: string, installRoot: string | undefined): void {
    do_pruneEmptyGitParents(this, targetDir, installRoot);
  }

  ensureNpmProject(installRoot: string): void {
    do_ensureNpmProject(this, installRoot);
  }

  ensureGitIgnore(dir: string): void {
    do_ensureGitIgnore(this, dir);
  }

  getNpmInstallRoot(scope: SourceScope, temporary: boolean): string {
    return do_getNpmInstallRoot(this, scope, temporary);
  }

  getGlobalNpmRoot(): string {
    return do_getGlobalNpmRoot(this);
  }

  getPnpmGlobalPackagePath(packageName: string): string | undefined {
    return do_getPnpmGlobalPackagePath(this, packageName);
  }

  getManagedNpmInstallPath(source: NpmSource, scope: SourceScope): string {
    return do_getManagedNpmInstallPath(this, source, scope);
  }

  getLegacyGlobalNpmInstallPath(source: NpmSource): string | undefined {
    return do_getLegacyGlobalNpmInstallPath(this, source);
  }

  getNpmInstallPath(source: NpmSource, scope: SourceScope): string {
    return do_getNpmInstallPath(this, source, scope);
  }

  getGitInstallPath(source: GitSource, scope: SourceScope): string {
    return do_getGitInstallPath(this, source, scope);
  }

  getGitInstallRoot(scope: SourceScope): string | undefined {
    return do_getGitInstallRoot(this, scope);
  }

  getTemporaryDir(prefix: string, suffix?: string): string {
    return do_getTemporaryDir(this, prefix, suffix);
  }

  resolveManagedPath(root: string, ...parts: string[]): string {
    return do_resolveManagedPath(this, root, ...parts);
  }

  getBaseDirForScope(scope: SourceScope): string {
    return do_getBaseDirForScope(this, scope);
  }

  resolvePath(input: string): string {
    return do_resolvePath(this, input);
  }

  resolvePathFromBase(input: string, baseDir: string): string {
    return do_resolvePathFromBase(this, input, baseDir);
  }

  collectPackageResources(
    packageRoot: string,
    accumulator: ResourceAccumulator,
    filter: PackageFilter | undefined,
    metadata: PathMetadata,
  ): boolean {
    return do_collectPackageResources(this, packageRoot, accumulator, filter, metadata);
  }

  collectDefaultResources(
    packageRoot: string,
    resourceType: ResourceType,
    target: Map<string, { metadata: PathMetadata; enabled: boolean }>,
    metadata: PathMetadata,
  ): void {
    do_collectDefaultResources(this, packageRoot, resourceType, target, metadata);
  }

  applyPackageFilter(
    packageRoot: string,
    userPatterns: string[],
    resourceType: ResourceType,
    target: Map<string, { metadata: PathMetadata; enabled: boolean }>,
    metadata: PathMetadata,
  ): void {
    do_applyPackageFilter(this, packageRoot, userPatterns, resourceType, target, metadata);
  }

  collectManifestFiles(
    packageRoot: string,
    resourceType: ResourceType,
  ): { allFiles: string[]; enabledByManifest: Set<string> } {
    return do_collectManifestFiles(this, packageRoot, resourceType);
  }

  readPiManifest(packageRoot: string): PiManifest | null {
    return do_readPiManifest(this, packageRoot);
  }

  addManifestEntries(
    entries: string[] | undefined,
    root: string,
    resourceType: ResourceType,
    target: Map<string, { metadata: PathMetadata; enabled: boolean }>,
    metadata: PathMetadata,
  ): void {
    do_addManifestEntries(this, entries, root, resourceType, target, metadata);
  }

  collectFilesFromManifestEntries(entries: string[], root: string, resourceType: ResourceType): string[] {
    return do_collectFilesFromManifestEntries(this, entries, root, resourceType);
  }

  resolveLocalEntries(
    entries: string[],
    resourceType: ResourceType,
    target: Map<string, { metadata: PathMetadata; enabled: boolean }>,
    metadata: PathMetadata,
    baseDir: string,
  ): void {
    do_resolveLocalEntries(this, entries, resourceType, target, metadata, baseDir);
  }

  addAutoDiscoveredResources(
    accumulator: ResourceAccumulator,
    globalSettings: ReturnType<SettingsManager["getGlobalSettings"]>,
    projectSettings: ReturnType<SettingsManager["getProjectSettings"]>,
    globalBaseDir: string,
    projectBaseDir: string,
  ): void {
    do_addAutoDiscoveredResources(this, accumulator, globalSettings, projectSettings, globalBaseDir, projectBaseDir);
  }

  collectFilesFromPaths(paths: string[], resourceType: ResourceType): string[] {
    return do_collectFilesFromPaths(this, paths, resourceType);
  }

  getTargetMap(
    accumulator: ResourceAccumulator,
    resourceType: ResourceType,
  ): Map<string, { metadata: PathMetadata; enabled: boolean }> {
    return do_getTargetMap(this, accumulator, resourceType);
  }

  addResource(
    map: Map<string, { metadata: PathMetadata; enabled: boolean }>,
    path: string,
    metadata: PathMetadata,
    enabled: boolean,
  ): void {
    do_addResource(this, map, path, metadata, enabled);
  }

  createAccumulator(): ResourceAccumulator {
    return do_createAccumulator(this);
  }

  toResolvedPaths(accumulator: ResourceAccumulator): ResolvedPaths {
    return do_toResolvedPaths(this, accumulator);
  }

  spawnCommand(command: string, args: string[], options?: { cwd?: string }): ChildProcess {
    return do_spawnCommand(this, command, args, options);
  }

  spawnCaptureCommand(
    command: string,
    args: string[],
    options?: { cwd?: string; env?: Record<string, string> },
  ): ChildProcessByStdio<null, Readable, Readable> {
    return do_spawnCaptureCommand(this, command, args, options);
  }

  runCommandCapture(
    command: string,
    args: string[],
    options?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> },
  ): Promise<string> {
    return do_runCommandCapture(this, command, args, options);
  }

  runCommand(command: string, args: string[], options?: { cwd?: string }): Promise<void> {
    return do_runCommand(this, command, args, options);
  }

  runCommandSync(command: string, args: string[]): string {
    return do_runCommandSync(this, command, args);
  }
}
