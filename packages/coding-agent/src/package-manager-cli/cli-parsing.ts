import chalk from "chalk";
import { APP_NAME } from "../config.ts";
import type { SettingsManager } from "../core/settings-manager.ts";
import type { PackageCommand } from "./types.ts";

export function reportSettingsErrors(settingsManager: SettingsManager, context: string): void {
  const errors = settingsManager.drainErrors();
  for (const { scope, error } of errors) {
    console.error(chalk.yellow(`Warning (${context}, ${scope} settings): ${error.message}`));
    if (error.stack) {
      console.error(chalk.dim(error.stack));
    }
  }
}

export function getPackageCommandUsage(command: PackageCommand): string {
  switch (command) {
    case "install":
      return `${APP_NAME} install <source> [-l] [--approve|--no-approve]`;
    case "remove":
      return `${APP_NAME} remove <source> [-l] [--approve|--no-approve]`;
    case "update":
      return `${APP_NAME} update [source|self|p] [--self] [--extensions] [--extension <source>] [--approve|--no-approve] [--force]`;
    case "list":
      return `${APP_NAME} list [--approve|--no-approve]`;
  }
}

export function printPackageCommandHelp(command: PackageCommand): void {
  switch (command) {
    case "install":
      console.log(`${chalk.bold("Usage:")}
  ${getPackageCommandUsage("install")}

Install a package and add it to settings.

Options:
  -l, --local       Install project-locally (.p/settings.json)
  -a, --approve     Trust project-local files for this command
  -na, --no-approve Ignore project-local files for this command

Examples:
  ${APP_NAME} install npm:@foo/bar
  ${APP_NAME} install git:github.com/user/repo
  ${APP_NAME} install git:git@github.com:user/repo
  ${APP_NAME} install https://github.com/user/repo
  ${APP_NAME} install ssh://git@github.com/user/repo
  ${APP_NAME} install ./local/path
`);
      return;

    case "remove":
      console.log(`${chalk.bold("Usage:")}
  ${getPackageCommandUsage("remove")}

Remove a package and its source from settings.
Alias: ${APP_NAME} uninstall <source> [-l]

Options:
  -l, --local       Remove from project settings (.p/settings.json)
  -a, --approve     Trust project-local files for this command
  -na, --no-approve Ignore project-local files for this command

Examples:
  ${APP_NAME} remove npm:@foo/bar
  ${APP_NAME} uninstall npm:@foo/bar
`);
      return;

    case "update":
      console.log(`${chalk.bold("Usage:")}
  ${getPackageCommandUsage("update")}

Update p and installed packages.

Options:
  --self                  Update p only
  --extensions            Update installed packages only
  --extension <source>    Update one package only
  -a, --approve           Trust project-local files for this command
  -na, --no-approve       Ignore project-local files for this command
  --force                 Reinstall p even if the current version is latest

Short forms:
  ${APP_NAME} update                Update p and all extensions
  ${APP_NAME} update <source>       Update one package
  ${APP_NAME} update p             Update p only (self works as alias to p)
`);
      return;

    case "list":
      console.log(`${chalk.bold("Usage:")}
  ${getPackageCommandUsage("list")}

List installed packages from user and project settings.

Options:
  -a, --approve      Trust project-local files for this command
  -na, --no-approve  Ignore project-local files for this command
`);
      return;
  }
}
