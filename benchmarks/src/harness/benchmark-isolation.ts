import { existsSync, realpathSync } from "node:fs";
import { dirname } from "node:path";

export interface BenchmarkIsolationPaths {
  workspace: string;
  runtime: string;
}

export interface SandboxedBenchmarkCommand {
  executable: string;
  args: string[];
}

export function benchmarkSandboxExecutable(): string | undefined {
  if (process.platform !== "darwin") return undefined;
  const executable = "/usr/bin/sandbox-exec";
  return existsSync(executable) ? executable : undefined;
}

export function createBenchmarkSandboxProfile(
  paths: BenchmarkIsolationPaths,
  nodeExecutable = process.execPath,
): string {
  const workspace = realpathSync(paths.workspace);
  const runtime = realpathSync(paths.runtime);
  const nodePath = realpathSync(nodeExecutable);
  const quote = (path: string): string => `"${path.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  const nodeInstallRoot = dirname(dirname(nodePath));
  const readableSystemRoots = [
    "/bin",
    "/usr/bin",
    "/usr/lib",
    "/System/Library",
    "/opt/homebrew/opt",
    "/opt/homebrew/Cellar",
    "/opt/homebrew/etc",
    dirname(nodePath),
    nodeInstallRoot,
  ];
  return [
    "(version 1)",
    "(deny default)",
    '(import "system.sb")',
    "(allow process-exec)",
    "(allow process-fork)",
    "(allow signal (target self))",
    "(allow sysctl-read)",
    "(allow file-read-metadata)",
    ...readableSystemRoots.map((root) => `(allow file-read* (subpath ${quote(root)}))`),
    `(allow file-read* (subpath ${quote(runtime)}))`,
    `(allow file-read* (subpath ${quote(workspace)}))`,
    `(allow file-write* (subpath ${quote(workspace)}))`,
  ].join(" ");
}

export function createSandboxedBenchmarkCommand(
  paths: BenchmarkIsolationPaths,
  executable: string,
  args: readonly string[],
  nodeExecutable = process.execPath,
): SandboxedBenchmarkCommand {
  const sandbox = benchmarkSandboxExecutable();
  if (!sandbox) throw new Error("macOS sandbox-exec is required for isolated benchmark execution");
  return {
    executable: sandbox,
    args: ["-p", createBenchmarkSandboxProfile(paths, nodeExecutable), executable, ...args],
  };
}
