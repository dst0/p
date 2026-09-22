import { Markdown } from "@dst0/p-tui";
import chalk from "chalk";
import {
  APP_NAME,
  getPackageDir,
  getSelfUpdateUnavailableInstruction,
  type InstallMethod,
  PACKAGE_NAME,
  readInstalledPackageVersion,
  type SelfUpdateCommand,
  VERSION,
} from "../config.ts";
import type { AppMode } from "../core/project-trust.ts";
import { spawnProcess } from "../utils/child-process.ts";
import { getLatestPiRelease, isNewerPackageVersion } from "../utils/version-check.ts";
import {
  cleanupWindowsSelfUpdateQuarantine,
  quarantineWindowsNativeDependencies,
} from "../utils/windows-self-update.ts";
import { SELF_UPDATE_NOTE_MARKDOWN_THEME } from "./constants.ts";
import type { SelfUpdatePlan, UpdateTarget } from "./types.ts";

export function updateTargetIncludesSelf(target: UpdateTarget): boolean {
  return target.type === "all" || target.type === "self";
}

export function updateTargetIncludesExtensions(target: UpdateTarget): boolean {
  return target.type === "all" || target.type === "extensions";
}

export function printSelfUpdateUnavailable(npmCommand?: string[]): void {
  console.error(`error: ${APP_NAME} cannot self-update this installation.`);
  console.error(getSelfUpdateUnavailableInstruction(PACKAGE_NAME, npmCommand));

  const entrypoint = process.argv[1];
  if (entrypoint) {
    console.error("");
    console.error(`Location of p executable: ${entrypoint}`);
  }
}

export function printSelfUpdateFallback(command: SelfUpdateCommand): void {
  console.error(chalk.dim(`If this keeps failing, run this command yourself: ${command.display}`));
}

export function printSelfUpdateNote(note: string): void {
  const trimmedNote = note.trim();
  if (!trimmedNote) {
    return;
  }

  console.log();
  console.log(chalk.bold(chalk.yellow("Update note")));
  try {
    const width = Math.max(20, process.stdout.columns ?? 80);
    const renderedLines = new Markdown(trimmedNote, 0, 0, SELF_UPDATE_NOTE_MARKDOWN_THEME)
      .render(width)
      .map((line) => line.trimEnd());
    console.log(renderedLines.join("\n"));
  } catch {
    console.log(trimmedNote);
  }
  console.log();
}

/** Self-update always reinstalls PACKAGE_NAME; the version check only decides whether to run and which notes to show. */
export async function getSelfUpdatePlan(force: boolean): Promise<SelfUpdatePlan> {
  if (force) {
    return { shouldRun: true };
  }

  try {
    const latestRelease = await getLatestPiRelease(VERSION);
    if (!latestRelease) {
      return { shouldRun: true };
    }
    if (isNewerPackageVersion(latestRelease.version, VERSION)) {
      const { version, note } = latestRelease;
      return { shouldRun: true, version, ...(note ? { note } : {}) };
    }
  } catch {
    return { shouldRun: true };
  }

  console.log(chalk.green(`${APP_NAME} is already up to date (v${VERSION})`));
  return { shouldRun: false };
}

export async function runSelfUpdate(command: SelfUpdateCommand): Promise<void> {
  console.log(chalk.dim(`Updating ${APP_NAME} with ${command.display}...`));
  await new Promise<void>((resolve, reject) => {
    const child = spawnProcess(command.command, command.args, {
      stdio: "inherit",
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
      } else if (signal) {
        reject(new Error(`${command.display} terminated by signal ${signal}`));
      } else {
        reject(new Error(`${command.display} exited with code ${code ?? "unknown"}`));
      }
    });
  });
}

/**
 * Prints the outcome of a finished self-update. Returns false when a pinned install left a different version in
 * place (for example a lagging registry mirror); unpinned installs and unreadable versions are reported as updated.
 */
export function reportSelfUpdateResult(
  command: SelfUpdateCommand,
  method: InstallMethod,
  npmCommand: string[] | undefined,
): boolean {
  const installedVersion = command.pinnedVersion
    ? readInstalledPackageVersion(method, PACKAGE_NAME, npmCommand)
    : undefined;
  if (installedVersion && installedVersion !== command.pinnedVersion) {
    console.error(
      chalk.red(
        `Error: expected ${APP_NAME} v${command.pinnedVersion} after updating, but v${installedVersion} is installed.`,
      ),
    );
    return false;
  }
  console.log(chalk.green(`Updated ${APP_NAME}${installedVersion ? ` to v${installedVersion}` : ""}`));
  return true;
}

export function prepareWindowsNpmSelfUpdate(): void {
  if (process.platform !== "win32") {
    return;
  }

  const packageDir = getPackageDir();
  cleanupWindowsSelfUpdateQuarantine(packageDir);
  quarantineWindowsNativeDependencies(packageDir);
}

export function parseProjectTrustOverride(args: readonly string[]): boolean | undefined {
  let trustOverride: boolean | undefined;
  for (const arg of args) {
    if (arg === "--approve" || arg === "-a") {
      trustOverride = true;
    } else if (arg === "--no-approve" || arg === "-na") {
      trustOverride = false;
    }
  }
  return trustOverride;
}

export function getCommandAppMode(): AppMode {
  return process.stdin.isTTY && process.stdout.isTTY ? "interactive" : "print";
}

export function reportProjectTrustWarnings(warnings: readonly string[]): void {
  for (const warning of warnings) {
    console.error(chalk.yellow(`Warning: ${warning}`));
  }
}
