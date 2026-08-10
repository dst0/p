import { existsSync, realpathSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import {
  findGitRoot,
  getInferredNpmInstall,
  getPackageDir,
  makeSelfUpdateCommand,
  makeSelfUpdateCommandStep,
  readCommandOutput,
} from "./self-update.ts";
import type { InstallMethod, SelfUpdateCommand } from "./types.ts";

export function getSelfUpdateCommandForMethod(
  method: InstallMethod,
  installedPackageName: string,
  updatePackageName = installedPackageName,
  npmCommand?: string[],
): SelfUpdateCommand | undefined {
  switch (method) {
    case "bun-binary":
      return undefined;
    case "pnpm": {
      const match = readCommandOutput("pnpm", ["root", "-g"])
        ? undefined
        : /^(.*[\\/]global[\\/][^\\/]+)[\\/]\.pnpm[\\/]/.exec(getPackageDir());
      const binDirArgs = match
        ? [`--config.global-bin-dir=${process.env.PNPM_HOME || dirname(dirname(match[1]))}`]
        : [];
      return makeSelfUpdateCommand(
        makeSelfUpdateCommandStep("pnpm", [
          "install",
          "-g",
          "--ignore-scripts",
          "--config.minimumReleaseAge=0",
          ...binDirArgs,
          updatePackageName,
        ]),
        updatePackageName === installedPackageName
          ? undefined
          : makeSelfUpdateCommandStep("pnpm", ["remove", "-g", ...binDirArgs, installedPackageName]),
      );
    }
    case "yarn":
      return makeSelfUpdateCommand(
        makeSelfUpdateCommandStep("yarn", ["global", "add", "--ignore-scripts", updatePackageName]),
        updatePackageName === installedPackageName
          ? undefined
          : makeSelfUpdateCommandStep("yarn", ["global", "remove", installedPackageName]),
      );
    case "bun":
      return makeSelfUpdateCommand(
        makeSelfUpdateCommandStep("bun", [
          "install",
          "-g",
          "--ignore-scripts",
          "--minimum-release-age=0",
          updatePackageName,
        ]),
        updatePackageName === installedPackageName
          ? undefined
          : makeSelfUpdateCommandStep("bun", ["uninstall", "-g", installedPackageName]),
      );
    case "npm": {
      const [command = "npm", ...npmArgs] = npmCommand ?? [];
      const inferred = npmCommand?.length ? undefined : getInferredNpmInstall();
      const prefixArgs = [...npmArgs, ...(inferred ? ["--prefix", inferred.prefix] : [])];
      const installStep = makeSelfUpdateCommandStep(command, [
        ...prefixArgs,
        "install",
        "-g",
        "--ignore-scripts",
        "--min-release-age=0",
        updatePackageName,
      ]);
      const uninstallStep =
        updatePackageName === installedPackageName
          ? undefined
          : makeSelfUpdateCommandStep(command, [...prefixArgs, "uninstall", "-g", installedPackageName]);
      return makeSelfUpdateCommand(installStep, uninstallStep);
    }
    case "source-checkout": {
      const packageDir = getPackageDir();
      const gitRoot = findGitRoot(packageDir);
      if (!gitRoot) return undefined;
      return makeSelfUpdateCommandStep("bash", ["-c", `cd ${gitRoot} && git pull && npm run build`]);
    }
    case "unknown":
      return undefined;
  }
}

export function getGlobalPackageRoots(method: InstallMethod, _packageName: string, npmCommand?: string[]): string[] {
  switch (method) {
    case "npm": {
      const configured = !!npmCommand?.length;
      const [command = "npm", ...npmArgs] = npmCommand ?? [];
      if (configured && command === "bun") {
        const bunBin = readCommandOutput(command, [...npmArgs, "pm", "bin", "-g"], {
          requireSuccess: true,
        });
        const roots = [join(homedir(), ".bun", "install", "global", "node_modules")];
        if (bunBin) {
          roots.push(join(dirname(bunBin), "install", "global", "node_modules"));
        }
        return roots;
      }
      const root = readCommandOutput(command, [...npmArgs, "root", "-g"], {
        requireSuccess: configured,
      });
      const inferred = configured ? undefined : getInferredNpmInstall();
      return [root, inferred?.root].filter((x): x is string => !!x);
    }
    case "pnpm": {
      const root = readCommandOutput("pnpm", ["root", "-g"]);
      if (root) return [root, dirname(root)];
      const match = /^(.*[\\/]global[\\/][^\\/]+)[\\/]\.pnpm[\\/]/.exec(getPackageDir());
      return match ? [match[1]] : [];
    }
    case "yarn": {
      const dir = readCommandOutput("yarn", ["global", "dir"]);
      return dir ? [dir, join(dir, "node_modules")] : [];
    }
    case "bun": {
      const bunBin = readCommandOutput("bun", ["pm", "bin", "-g"]);
      const roots = [join(homedir(), ".bun", "install", "global", "node_modules")];
      if (bunBin) {
        roots.push(join(dirname(bunBin), "install", "global", "node_modules"));
      }
      return roots;
    }
    case "bun-binary":
    case "source-checkout":
    case "unknown":
      return [];
  }
}

export function normalizeExistingPathForComparison(path: string, resolveSymlinks: boolean): string | undefined {
  const resolvedPath = resolve(path);
  if (!existsSync(resolvedPath)) {
    return undefined;
  }
  let normalizedPath = resolvedPath;
  if (resolveSymlinks) {
    try {
      normalizedPath = realpathSync(resolvedPath);
    } catch {
      return undefined;
    }
  }
  if (process.platform === "win32") {
    normalizedPath = normalizedPath.toLowerCase();
  }
  return normalizedPath;
}

export function getPathComparisonCandidates(path: string): string[] {
  return Array.from(
    new Set(
      [normalizeExistingPathForComparison(path, false), normalizeExistingPathForComparison(path, true)].filter(
        (candidate): candidate is string => !!candidate,
      ),
    ),
  );
}
