import { existsSync, readFileSync } from "fs";
import { basename, dirname, join, win32 } from "path";
import { spawnProcessSync } from "../utils/child-process.ts";
import { normalizePath } from "../utils/paths.ts";
import { __dirname, isBunBinary, isBunRuntime } from "./constants.ts";
import type { InstallMethod, SelfUpdateCommand, SelfUpdateCommandStep } from "./types.ts";

export function makeSelfUpdateCommand(
  installStep: SelfUpdateCommandStep,
  uninstallStep?: SelfUpdateCommandStep,
): SelfUpdateCommand {
  if (!uninstallStep) return installStep;
  return {
    ...installStep,
    display: `${uninstallStep.display} && ${installStep.display}`,
    steps: [uninstallStep, installStep],
  };
}

export function makeSelfUpdateCommandStep(command: string, args: string[]): SelfUpdateCommandStep {
  return {
    command,
    args,
    display: [command, ...args].map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(" "),
  };
}

export function getPackageDir(): string {
  // Allow override via environment variable (useful for Nix/Guix where store paths tokenize poorly)
  const envDir = process.env.P_PACKAGE_DIR;
  if (envDir) {
    return normalizePath(envDir);
  }

  if (isBunBinary) {
    // Bun binary: process.execPath points to the compiled executable
    return dirname(process.execPath);
  }
  // Node.js: walk up from __dirname until we find package.json
  let dir = __dirname;
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, "package.json"))) {
      return dir;
    }
    dir = dirname(dir);
  }
  // Fallback (shouldn't happen)
  return __dirname;
}

export function isGitMetadataPath(gitPath: string): boolean {
  if (existsSync(join(gitPath, "HEAD"))) return true;
  try {
    return readFileSync(gitPath, "utf8").trimStart().startsWith("gitdir:");
  } catch {
    return false;
  }
}

export function findGitRoot(startDir: string): string | undefined {
  let dir = startDir;
  while (dir !== dirname(dir)) {
    if (isGitMetadataPath(join(dir, ".git"))) {
      return dir;
    }
    dir = dirname(dir);
  }
  return undefined;
}

export function detectInstallMethod(): InstallMethod {
  if (isBunBinary) {
    return "bun-binary";
  }

  const resolvedPath = `${__dirname}\0${process.execPath || ""}`.toLowerCase().replace(/\\/g, "/");

  if (resolvedPath.includes("/pnpm/") || resolvedPath.includes("/.pnpm/")) {
    return "pnpm";
  }
  if (resolvedPath.includes("/yarn/") || resolvedPath.includes("/.yarn/")) {
    return "yarn";
  }
  if (isBunRuntime || resolvedPath.includes("/install/global/node_modules/")) {
    return "bun";
  }
  if (resolvedPath.includes("/npm/") || resolvedPath.includes("/node_modules/")) {
    // Check if this is actually a source checkout (git repo) rather than an npm install
    const packageDir = getPackageDir();
    const gitRoot = findGitRoot(packageDir);
    if (gitRoot) {
      return "source-checkout";
    }
    return "npm";
  }

  return "unknown";
}

export function getInferredNpmInstall(): { root: string; prefix: string } | undefined {
  const packageDir = getPackageDir();
  const path = process.platform === "win32" || packageDir.includes("\\") ? win32 : { basename, dirname };
  const parent = path.dirname(packageDir);
  let root: string | undefined;
  if (path.basename(parent).startsWith("@") && path.basename(path.dirname(parent)) === "node_modules") {
    root = path.dirname(parent);
  } else if (path.basename(parent) === "node_modules") {
    root = parent;
  }
  if (!root) return undefined;
  const rootParent = path.dirname(root);
  if (path.basename(rootParent) === "lib") return { root, prefix: path.dirname(rootParent) };
  // Windows global npm prefixes use `<prefix>\\node_modules`, which is
  // indistinguishable from local project installs by path shape alone. Do not
  // infer unsupported Windows custom prefixes without `npm root -g` evidence.
  return undefined;
}

export function readCommandOutput(
  command: string,
  args: string[],
  options: { requireSuccess?: boolean } = {},
): string | undefined {
  const result = spawnProcessSync(command, args, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status === 0) return result.stdout.trim() || undefined;
  if (options.requireSuccess) {
    const reason = result.error?.message || result.stderr.trim() || `exit code ${result.status ?? "unknown"}`;
    throw new Error(`Failed to run ${[command, ...args].join(" ")}: ${reason}`);
  }
  return undefined;
}
