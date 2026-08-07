import { selectConfig } from "../cli/config-selector.ts";
import { createProjectTrustContext } from "../cli/project-trust.ts";
import { getAgentDir } from "../config.ts";
import type { ExtensionFactory } from "../core/extensions/types.ts";
import { DefaultPackageManager } from "../core/package-manager.ts";
import { resolveProjectTrusted } from "../core/project-trust.ts";
import { DefaultResourceLoader } from "../core/resource-loader.ts";
import { SettingsManager } from "../core/settings-manager.ts";
import { hasTrustRequiringProjectResources, ProjectTrustStore } from "../core/trust-manager.ts";
import { reportSettingsErrors } from "./helpers-part1.ts";
import { getCommandAppMode, parseProjectTrustOverride, reportProjectTrustWarnings } from "./helpers-part3.ts";
import type { CommandSettingsResult, PackageCommandRuntimeOptions } from "./types.ts";

export async function createCommandSettingsManager(options: {
  cwd: string;
  agentDir: string;
  projectTrustOverride?: boolean;
  useSavedProjectTrustOnly?: boolean;
  extensionFactories?: ExtensionFactory[];
}): Promise<CommandSettingsResult> {
  const settingsManager = SettingsManager.create(options.cwd, options.agentDir, { projectTrusted: false });
  const projectTrustWarnings: string[] = [];
  const trustStore = new ProjectTrustStore(options.agentDir);
  if (options.useSavedProjectTrustOnly) {
    const savedProjectTrusted = trustStore.get(options.cwd) === true;
    settingsManager.setProjectTrusted(options.projectTrustOverride ?? savedProjectTrusted);
    return { settingsManager, projectTrustWarnings };
  }

  const appMode = getCommandAppMode();
  const extensionsResult =
    options.projectTrustOverride === undefined && hasTrustRequiringProjectResources(options.cwd)
      ? await new DefaultResourceLoader({
          cwd: options.cwd,
          agentDir: options.agentDir,
          settingsManager,
          extensionFactories: options.extensionFactories,
        }).loadProjectTrustExtensions()
      : undefined;
  for (const error of extensionsResult?.errors ?? []) {
    projectTrustWarnings.push(`Failed to load extension "${error.path}": ${error.error}`);
  }

  const projectTrusted = await resolveProjectTrusted({
    cwd: options.cwd,
    trustStore,
    trustOverride: options.projectTrustOverride,
    defaultProjectTrust: settingsManager.getDefaultProjectTrust(),
    extensionsResult,
    projectTrustContext: createProjectTrustContext({
      cwd: options.cwd,
      mode: appMode,
      settingsManager,
      hasUI: appMode === "interactive",
    }),
    onExtensionError: (message) => projectTrustWarnings.push(message),
  });
  settingsManager.setProjectTrusted(projectTrusted);
  return { settingsManager, projectTrustWarnings };
}

export async function handleConfigCommand(
  args: string[],
  runtimeOptions: PackageCommandRuntimeOptions = {},
): Promise<boolean> {
  if (args[0] !== "config") {
    return false;
  }

  const cwd = process.cwd();
  const agentDir = getAgentDir();
  const { settingsManager, projectTrustWarnings } = await createCommandSettingsManager({
    cwd,
    agentDir,
    projectTrustOverride: parseProjectTrustOverride(args),
    extensionFactories: runtimeOptions.extensionFactories,
  });
  reportProjectTrustWarnings(projectTrustWarnings);
  reportSettingsErrors(settingsManager, "config command");
  const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
  const resolvedPaths = await packageManager.resolve();

  await selectConfig({
    resolvedPaths,
    settingsManager,
    cwd,
    agentDir,
  });

  process.exit(0);
}
