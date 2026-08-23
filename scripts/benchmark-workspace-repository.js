import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { devNull } from "node:os";
import { join } from "node:path";

const BASELINE_COMMANDS = [
  ["init", "--quiet", "--initial-branch=main"],
  ["config", "--local", "user.name", "P Benchmark"],
  ["config", "--local", "user.email", "benchmark@invalid.example"],
  ["config", "--local", "commit.gpgSign", "false"],
  ["config", "--local", "core.hooksPath", ".git/hooks-disabled"],
  ["config", "--local", "gc.auto", "0"],
  ["config", "--local", "gc.autoDetach", "false"],
  ["config", "--local", "maintenance.auto", "false"],
  ["add", "--all"],
  ["commit", "--quiet", "--no-gpg-sign", "-m", "Benchmark fixture baseline"],
];

export function sanitizeBenchmarkGitEnvironment(environment = process.env) {
  const sanitized = {};
  for (const [key, value] of Object.entries(environment)) {
    if (!key.toUpperCase().startsWith("GIT_")) sanitized[key] = value;
  }
  return {
    ...sanitized,
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
}

export function initializeBenchmarkWorkspaceRepository(workspace, run = spawnSync) {
  const environment = {
    ...sanitizeBenchmarkGitEnvironment(),
    GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
  };
  for (const args of BASELINE_COMMANDS) {
    const result = run("git", args, { cwd: workspace, encoding: "utf8", env: environment, stdio: "pipe" });
    if (result.error) throw new Error("Unable to create the benchmark Git baseline", { cause: result.error });
    if (result.status !== 0) throw new Error("Unable to create the benchmark Git baseline");
  }
}

export function createBenchmarkWorkspace(root, agent, runNumber, task, options) {
  const workspace = join(root, "workspaces", agent, `run-${runNumber}`, task.id);
  mkdirSync(workspace, { recursive: true });
  for (const [relativePath, content] of Object.entries(task.files)) {
    const path = join(workspace, relativePath);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content, "utf8");
  }
  if (agent === "p" && options.projectInstructions) {
    copyFileSync(options.projectInstructionsFile, join(workspace, "AGENTS.md"));
  }
  initializeBenchmarkWorkspaceRepository(workspace);
  return workspace;
}
