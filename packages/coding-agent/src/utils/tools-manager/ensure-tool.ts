import chalk from "chalk";
import { platform } from "os";
import { downloadTool } from "./binary-extraction.ts";
import { TERMUX_PACKAGES, TOOLS } from "./constants.ts";
import { acquireDownloadLock, getToolPath, isOfflineModeEnabled, releaseDownloadLock } from "./download-management.ts";

export async function ensureTool(tool: "fd" | "rg", silent: boolean = false): Promise<string | undefined> {
  const existingPath = getToolPath(tool);
  if (existingPath) {
    return existingPath;
  }

  const config = TOOLS[tool];
  if (!config) return undefined;

  if (isOfflineModeEnabled()) {
    if (!silent) {
      console.log(chalk.yellow(`${config.name} not found. Offline mode enabled, skipping download.`));
    }
    return undefined;
  }

  // On Android/Termux, Linux binaries don't work due to Bionic libc incompatibility.
  // Users must install via pkg.
  if (platform() === "android") {
    const pkgName = TERMUX_PACKAGES[tool] ?? tool;
    if (!silent) {
      console.log(chalk.yellow(`${config.name} not found. Install with: pkg install ${pkgName}`));
    }
    return undefined;
  }

  // Tool not found - download it
  if (!silent) {
    console.log(chalk.dim(`${config.name} not found. Downloading...`));
  }

  try {
    const lock = await acquireDownloadLock(tool);
    let path: string;
    try {
      path = getToolPath(tool) ?? (await downloadTool(tool));
    } finally {
      releaseDownloadLock(lock);
    }
    if (!silent) {
      console.log(chalk.dim(`${config.name} installed to ${path}`));
    }
    return path;
  } catch (e) {
    if (!silent) {
      console.log(chalk.yellow(`Failed to download ${config.name}: ${e instanceof Error ? e.message : e}`));
    }
    return undefined;
  }
}
