import { type DelegatedMethods, installDelegatedMethods } from "../../utils/install-delegated-methods.ts";
import { resolvePath } from "../../utils/paths.ts";
import type { SettingsManager } from "../settings-manager.ts";
import * as cacheOperationsDelegates from "./defaultpackagemanager-methods/cache-operations.ts";
import * as globalPackagesDelegates from "./defaultpackagemanager-methods/global-packages.ts";
import * as installDelegates from "./defaultpackagemanager-methods/install.ts";
import * as listInstalledDelegates from "./defaultpackagemanager-methods/list-installed.ts";
import * as lockfileAnalysisDelegates from "./defaultpackagemanager-methods/lockfile-analysis.ts";
import * as projectInitDelegates from "./defaultpackagemanager-methods/project-init.ts";
import * as registryMetadataDelegates from "./defaultpackagemanager-methods/registry-metadata.ts";
import * as resolveBinaryDelegates from "./defaultpackagemanager-methods/resolve-binary.ts";
import * as resolveVersionDelegates from "./defaultpackagemanager-methods/resolve-version.ts";
import * as scanDependenciesDelegates from "./defaultpackagemanager-methods/scan-dependencies.ts";
import * as scriptExecutionDelegates from "./defaultpackagemanager-methods/script-execution.ts";
import * as uninstallDelegates from "./defaultpackagemanager-methods/uninstall.ts";
import * as workspaceDetectionDelegates from "./defaultpackagemanager-methods/workspace-detection.ts";
import type { PackageManager, PackageManagerOptions, ProgressCallback } from "./types.ts";

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: The installer below synchronously defines every delegated method.
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

  async runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
    return uninstallDelegates.do_runWithConcurrency(this, tasks, limit);
  }
}

type DefaultPackageManagerMethods = DelegatedMethods<
  DefaultPackageManager,
  typeof cacheOperationsDelegates &
    typeof globalPackagesDelegates &
    typeof installDelegates &
    typeof listInstalledDelegates &
    typeof lockfileAnalysisDelegates &
    typeof projectInitDelegates &
    typeof registryMetadataDelegates &
    typeof resolveBinaryDelegates &
    typeof resolveVersionDelegates &
    typeof scanDependenciesDelegates &
    typeof scriptExecutionDelegates &
    typeof uninstallDelegates &
    typeof workspaceDetectionDelegates
>;

export interface DefaultPackageManager extends DefaultPackageManagerMethods {}

installDelegatedMethods(DefaultPackageManager.prototype, [
  cacheOperationsDelegates,
  globalPackagesDelegates,
  installDelegates,
  listInstalledDelegates,
  lockfileAnalysisDelegates,
  projectInitDelegates,
  registryMetadataDelegates,
  resolveBinaryDelegates,
  resolveVersionDelegates,
  scanDependenciesDelegates,
  scriptExecutionDelegates,
  uninstallDelegates,
  workspaceDetectionDelegates,
]);
