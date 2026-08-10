import type { ChildProcess, ChildProcessByStdio } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import type { Readable } from "node:stream";
import { spawnProcess } from "../../../utils/child-process.ts";
import { canonicalizePath } from "../../../utils/paths.ts";
import { isStdoutTakenOver } from "../../output-guard.ts";
import { collectResourceFiles } from "../binary-resolution.ts";
import type { DefaultPackageManager } from "../defaultpackagemanager.ts";
import type { PathMetadata, ResolvedPaths, ResolvedResource, ResourceAccumulator, ResourceType } from "../types.ts";
import { getEnv, resourcePrecedenceRank } from "../version-resolution.ts";

export function do_collectFilesFromPaths(
  _self: DefaultPackageManager,
  paths: string[],
  resourceType: ResourceType,
): string[] {
  const files: string[] = [];
  for (const p of paths) {
    if (!existsSync(p)) continue;

    try {
      const stats = statSync(p);
      if (stats.isFile()) {
        files.push(p);
      } else if (stats.isDirectory()) {
        files.push(...collectResourceFiles(p, resourceType));
      }
    } catch {
      // Ignore errors
    }
  }
  return files;
}

export function do_getTargetMap(
  _self: DefaultPackageManager,
  accumulator: ResourceAccumulator,
  resourceType: ResourceType,
): Map<string, { metadata: PathMetadata; enabled: boolean }> {
  switch (resourceType) {
    case "extensions":
      return accumulator.extensions;
    case "skills":
      return accumulator.skills;
    case "prompts":
      return accumulator.prompts;
    case "themes":
      return accumulator.themes;
    default:
      throw new Error(`Unknown resource type: ${resourceType}`);
  }
}

export function do_addResource(
  _self: DefaultPackageManager,
  map: Map<string, { metadata: PathMetadata; enabled: boolean }>,
  path: string,
  metadata: PathMetadata,
  enabled: boolean,
): void {
  if (!path) return;
  if (!map.has(path)) {
    map.set(path, { metadata, enabled });
  }
}

export function do_createAccumulator(_self: DefaultPackageManager): ResourceAccumulator {
  return {
    extensions: new Map(),
    skills: new Map(),
    prompts: new Map(),
    themes: new Map(),
  };
}

export function do_toResolvedPaths(_self: DefaultPackageManager, accumulator: ResourceAccumulator): ResolvedPaths {
  const mapToResolved = (entries: Map<string, { metadata: PathMetadata; enabled: boolean }>): ResolvedResource[] => {
    const resolved = Array.from(entries.entries()).map(([path, { metadata, enabled }]) => ({
      path,
      enabled,
      metadata,
    }));
    resolved.sort((a, b) => resourcePrecedenceRank(a.metadata) - resourcePrecedenceRank(b.metadata));

    const seen = new Set<string>();
    return resolved.filter((entry) => {
      const canonicalPath = canonicalizePath(entry.path);
      if (seen.has(canonicalPath)) return false;
      seen.add(canonicalPath);
      return true;
    });
  };

  return {
    extensions: mapToResolved(accumulator.extensions),
    skills: mapToResolved(accumulator.skills),
    prompts: mapToResolved(accumulator.prompts),
    themes: mapToResolved(accumulator.themes),
  };
}

export function do_spawnCommand(
  _self: DefaultPackageManager,
  command: string,
  args: string[],
  options?: { cwd?: string },
): ChildProcess {
  const env = getEnv();
  return spawnProcess(command, args, {
    cwd: options?.cwd,
    stdio: isStdoutTakenOver() ? ["ignore", 2, 2] : "inherit",
    env,
  });
}

export function do_spawnCaptureCommand(
  _self: DefaultPackageManager,
  command: string,
  args: string[],
  options?: { cwd?: string; env?: Record<string, string> },
): ChildProcessByStdio<null, Readable, Readable> {
  const baseEnv = getEnv();
  const env = options?.env ? { ...baseEnv, ...options.env } : baseEnv;
  return spawnProcess(command, args, {
    cwd: options?.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env,
  });
}

export function do_runCommandCapture(
  self: DefaultPackageManager,
  command: string,
  args: string[],
  options?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> },
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = self.spawnCaptureCommand(command, args, options);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout =
      typeof options?.timeoutMs === "number"
        ? setTimeout(() => {
            timedOut = true;
            child.kill();
          }, options.timeoutMs)
        : undefined;

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });
    child.once("error", (error) => {
      if (timeout) clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      if (timeout) clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`${command} ${args.join(" ")} timed out after ${options?.timeoutMs}ms`));
        return;
      }
      if (code === 0) {
        resolvePromise(stdout.trim());
        return;
      }
      const exitStatus = code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`;
      reject(new Error(`${command} ${args.join(" ")} failed with ${exitStatus}: ${stderr || stdout}`));
    });
  });
}

export function do_runCommand(
  self: DefaultPackageManager,
  command: string,
  args: string[],
  options?: { cwd?: string },
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = self.spawnCommand(command, args, options);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`${command} ${args.join(" ")} failed with code ${code}`));
      }
    });
  });
}
