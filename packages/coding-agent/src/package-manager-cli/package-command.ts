import chalk from "chalk";
import { APP_NAME, detectInstallMethod, getAgentDir, getSelfUpdateCommand, PACKAGE_NAME } from "../config.ts";
import { DefaultPackageManager } from "../core/package-manager.ts";
import { getPackageCommandUsage, printPackageCommandHelp, reportSettingsErrors } from "./cli-parsing.ts";
import { createCommandSettingsManager } from "./config-command.ts";
import { parsePackageCommand } from "./install-command.ts";
import {
  getSelfUpdatePlan,
  prepareWindowsNpmSelfUpdate,
  printSelfUpdateFallback,
  printSelfUpdateNote,
  printSelfUpdateUnavailable,
  reportProjectTrustWarnings,
  runSelfUpdate,
  updateTargetIncludesExtensions,
  updateTargetIncludesSelf,
} from "./list-command.ts";
import type { PackageCommandRuntimeOptions } from "./types.ts";

export async function handlePackageCommand(
  args: string[],
  runtimeOptions: PackageCommandRuntimeOptions = {},
): Promise<boolean> {
  const options = parsePackageCommand(args);
  if (!options) {
    return false;
  }

  if (options.help) {
    printPackageCommandHelp(options.command);
    return true;
  }

  if (options.invalidOption) {
    console.error(chalk.red(`Unknown option ${options.invalidOption} for "${options.command}".`));
    console.error(chalk.dim(`Use "${APP_NAME} --help" or "${getPackageCommandUsage(options.command)}".`));
    process.exitCode = 1;
    return true;
  }

  if (options.missingOptionValue) {
    console.error(chalk.red(`Missing value for ${options.missingOptionValue}.`));
    console.error(chalk.dim(`Usage: ${getPackageCommandUsage(options.command)}`));
    process.exitCode = 1;
    return true;
  }

  if (options.invalidArgument) {
    console.error(chalk.red(`Unexpected argument ${options.invalidArgument}.`));
    console.error(chalk.dim(`Usage: ${getPackageCommandUsage(options.command)}`));
    process.exitCode = 1;
    return true;
  }

  if (options.conflictingOptions) {
    console.error(chalk.red(options.conflictingOptions));
    console.error(chalk.dim(`Usage: ${getPackageCommandUsage(options.command)}`));
    process.exitCode = 1;
    return true;
  }

  const source = options.source;
  if ((options.command === "install" || options.command === "remove") && !source) {
    console.error(chalk.red(`Missing ${options.command} source.`));
    console.error(chalk.dim(`Usage: ${getPackageCommandUsage(options.command)}`));
    process.exitCode = 1;
    return true;
  }

  const cwd = process.cwd();
  const agentDir = getAgentDir();
  const writesProjectPackageConfig = (options.command === "install" || options.command === "remove") && options.local;
  const { settingsManager, projectTrustWarnings } = await createCommandSettingsManager({
    cwd,
    agentDir,
    projectTrustOverride: options.projectTrustOverride,
    useSavedProjectTrustOnly: options.command === "update",
    extensionFactories: runtimeOptions.extensionFactories,
  });
  reportProjectTrustWarnings(projectTrustWarnings);
  if (!settingsManager.isProjectTrusted() && writesProjectPackageConfig) {
    console.error(chalk.red("Project is not trusted. Use --approve to modify local package config."));
    process.exitCode = 1;
    return true;
  }
  reportSettingsErrors(settingsManager, "package command");
  const selfUpdateNpmCommand = settingsManager.getGlobalSettings().npmCommand;

  const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });

  packageManager.setProgressCallback((event) => {
    if (event.type === "start") {
      process.stdout.write(chalk.dim(`${event.message}\n`));
    }
  });

  try {
    switch (options.command) {
      case "install":
        await packageManager.installAndPersist(source!, { local: options.local });
        console.log(chalk.green(`Installed ${source}`));
        return true;

      case "remove": {
        const removed = await packageManager.removeAndPersist(source!, { local: options.local });
        if (!removed) {
          console.error(chalk.red(`No matching package found for ${source}`));
          process.exitCode = 1;
          return true;
        }
        console.log(chalk.green(`Removed ${source}`));
        return true;
      }

      case "list": {
        const configuredPackages = packageManager.listConfiguredPackages();
        const userPackages = configuredPackages.filter((pkg) => pkg.scope === "user");
        const projectPackages = configuredPackages.filter((pkg) => pkg.scope === "project");

        if (configuredPackages.length === 0) {
          console.log(chalk.dim("No packages installed."));
          return true;
        }

        const formatPackage = (pkg: (typeof configuredPackages)[number]) => {
          const display = pkg.filtered ? `${pkg.source} (filtered)` : pkg.source;
          console.log(`  ${display}`);
          if (pkg.installedPath) {
            console.log(chalk.dim(`    ${pkg.installedPath}`));
          }
        };

        if (userPackages.length > 0) {
          console.log(chalk.bold("User packages:"));
          for (const pkg of userPackages) {
            formatPackage(pkg);
          }
        }

        if (projectPackages.length > 0) {
          if (userPackages.length > 0) console.log();
          console.log(chalk.bold("Project packages:"));
          for (const pkg of projectPackages) {
            formatPackage(pkg);
          }
        }

        return true;
      }

      case "update": {
        const target = options.updateTarget ?? { type: "all" };
        if (updateTargetIncludesExtensions(target)) {
          const updateSource = target.type === "extensions" ? target.source : undefined;
          await packageManager.update(updateSource);
          if (updateSource) {
            console.log(chalk.green(`Updated ${updateSource}`));
          } else {
            console.log(chalk.green("Updated packages"));
          }
        }
        if (updateTargetIncludesSelf(target)) {
          const selfUpdatePlan = await getSelfUpdatePlan(options.force);
          if (!selfUpdatePlan.shouldRun) {
            return true;
          }
          const installMethod = detectInstallMethod();
          if (process.platform === "win32" && installMethod !== "npm" && installMethod !== "pnpm") {
            console.error(chalk.red(`${APP_NAME} self-update on Windows is only supported for npm and pnpm installs.`));
            console.error(chalk.dim(`Detected install method: ${installMethod}. Update ${APP_NAME} manually.`));
            process.exitCode = 1;
            return true;
          }
          const selfUpdateCommand = getSelfUpdateCommand(
            PACKAGE_NAME,
            selfUpdateNpmCommand,
            selfUpdatePlan.packageName,
          );
          if (!selfUpdateCommand) {
            printSelfUpdateUnavailable(selfUpdateNpmCommand, selfUpdatePlan.packageName);
            process.exitCode = 1;
            return true;
          }
          if (selfUpdatePlan.note) {
            printSelfUpdateNote(selfUpdatePlan.note);
          }
          try {
            if (installMethod === "npm") {
              prepareWindowsNpmSelfUpdate();
            }
            await runSelfUpdate(selfUpdateCommand);
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "Unknown package command error";
            console.error(chalk.red(`Error: ${message}`));
            printSelfUpdateFallback(selfUpdateCommand);
            process.exitCode = 1;
            return true;
          }
          console.log(chalk.green(`Updated ${APP_NAME}`));
        }
        return true;
      }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown package command error";
    console.error(chalk.red(`Error: ${message}`));
    process.exitCode = 1;
    return true;
  }
}
