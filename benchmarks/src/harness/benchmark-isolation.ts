import { existsSync, realpathSync } from "node:fs";
import { dirname } from "node:path";

export interface BenchmarkIsolationPaths {
  workspace: string;
  runtime: string;
  configDir?: string;
  extraReadPaths?: readonly string[];
  networkHosts?: readonly string[];
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
    dirname(nodePath),
    nodeInstallRoot,
    ...(nodePath.startsWith("/opt/homebrew/")
      ? [
          "/opt/homebrew/opt",
          "/opt/homebrew/Cellar",
          ...(existsSync("/opt/homebrew/etc/openssl@3") ? ["/opt/homebrew/etc/openssl@3"] : []),
        ]
      : []),
  ];
  const configDir = paths.configDir && existsSync(paths.configDir) ? realpathSync(paths.configDir) : undefined;
  const extraLiterals = new Set<string>();
  for (const candidate of paths.extraReadPaths ?? []) {
    if (!candidate) continue;
    if (existsSync(candidate)) {
      const real = realpathSync(candidate);
      extraLiterals.add(real);
      extraLiterals.add(candidate);
    }
  }
  const networkPorts = new Set(
    (paths.networkHosts ?? []).map((endpoint) => endpoint.slice(endpoint.lastIndexOf(":") + 1)),
  );

  return [
    "(version 1)",
    "(deny default)",
    '(import "system.sb")',
    "(allow process-exec)",
    "(allow process-fork)",
    "(allow signal (target self))",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    ...Array.from(networkPorts).map((port) => `(allow network-outbound (remote tcp "*:${port}"))`),
    "(allow file-read-metadata)",
    ...readableSystemRoots.map((root) => `(allow file-read* (subpath ${quote(root)}))`),
    ...(configDir
      ? [`(allow file-read* (subpath ${quote(configDir)}))`, `(allow file-write* (subpath ${quote(configDir)}))`]
      : []),
    ...Array.from(extraLiterals).map((literal) => `(allow file-read* (literal ${quote(literal)}))`),
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
  const effectivePaths: BenchmarkIsolationPaths = {
    ...paths,
    extraReadPaths: [...(paths.extraReadPaths ?? []), executable],
  };
  return {
    executable: sandbox,
    args: ["-p", createBenchmarkSandboxProfile(effectivePaths, nodeExecutable), executable, ...args],
  };
}

export function assertBenchmarkContainment(
  paths: BenchmarkIsolationPaths,
  excluded: { repoRoot: string; evaluatorPath: string },
): void {
  const sandbox = benchmarkSandboxExecutable();
  if (!sandbox) {
    throw new Error("Certified benchmark mode requires containment via macOS sandbox-exec");
  }
  const workspace = realpathSync(paths.workspace);
  const runtime = realpathSync(paths.runtime);
  const repo = realpathSync(excluded.repoRoot);
  const evaluator = realpathSync(excluded.evaluatorPath);

  const isContainedIn = (candidate: string, parent: string): boolean => {
    return candidate === parent || candidate.startsWith(`${parent}/`);
  };

  if (isContainedIn(workspace, repo) || isContainedIn(workspace, evaluator)) {
    throw new Error("Benchmark workspace escapes containment into repo or evaluator");
  }
  if (isContainedIn(runtime, repo) || isContainedIn(runtime, evaluator)) {
    throw new Error("Candidate runtime escapes containment into repo or evaluator");
  }
  if (isContainedIn(repo, workspace) || isContainedIn(repo, runtime)) {
    throw new Error("Live repository is accessible inside benchmark candidate containment");
  }
  if (isContainedIn(evaluator, workspace) || isContainedIn(evaluator, runtime)) {
    throw new Error("Evaluator freeze is accessible inside benchmark candidate containment");
  }
}
