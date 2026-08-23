import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createBenchmarkWorkspace,
  initializeBenchmarkWorkspaceRepository,
  sanitizeBenchmarkGitEnvironment,
} from "./benchmark-workspace-repository.js";

test("strips every inherited Git control variable and installs safe configuration boundaries", () => {
  const environment = sanitizeBenchmarkGitEnvironment({
    MARKER: "kept",
    GIT_DIR: "/hostile/repository",
    Git_Work_Tree: "/hostile/worktree",
    GIT_INDEX_FILE: "/hostile/index",
    GIT_CONFIG_PARAMETERS: "'core.hooksPath=/hostile/hooks'",
    GIT_OBJECT_DIRECTORY: "/hostile/objects",
    GIT_TEMPLATE_DIR: "/hostile/templates",
    GIT_SSH_COMMAND: "hostile-ssh",
    GIT_TRACE: "1",
    GIT_FUTURE_CONTROL: "hostile",
    GIT_CONFIG_GLOBAL: "/hostile/gitconfig",
    GIT_CONFIG_NOSYSTEM: "0",
  });

  assert.equal(environment.MARKER, "kept");
  assert.equal(environment.GIT_CONFIG_GLOBAL, devNull);
  assert.equal(environment.GIT_CONFIG_NOSYSTEM, "1");
  assert.equal(environment.GIT_TERMINAL_PROMPT, "0");
  assert.equal("GIT_DIR" in environment, false);
  assert.equal("Git_Work_Tree" in environment, false);
  assert.equal("GIT_INDEX_FILE" in environment, false);
  assert.equal("GIT_CONFIG_PARAMETERS" in environment, false);
  assert.equal("GIT_OBJECT_DIRECTORY" in environment, false);
  assert.equal("GIT_TEMPLATE_DIR" in environment, false);
  assert.equal("GIT_SSH_COMMAND" in environment, false);
  assert.equal("GIT_TRACE" in environment, false);
  assert.equal("GIT_FUTURE_CONTROL" in environment, false);
});

test("creates an isolated clean baseline with automatic Git maintenance disabled", () => {
  const workspace = mkdtempSync(join(tmpdir(), "p-benchmark-git-baseline-"));
  try {
    writeFileSync(join(workspace, "protected.txt"), "baseline\n");
    initializeBenchmarkWorkspaceRepository(workspace);

    assert.equal(git(workspace, "status", "--porcelain"), "");
    assert.equal(git(workspace, "remote"), "");
    assert.equal(git(workspace, "rev-list", "--count", "HEAD"), "1");
    assert.equal(git(workspace, "config", "--local", "--get", "core.hooksPath"), ".git/hooks-disabled");
    assert.equal(git(workspace, "config", "--local", "--get", "gc.auto"), "0");
    assert.equal(git(workspace, "config", "--local", "--get", "gc.autoDetach"), "false");
    assert.equal(git(workspace, "config", "--local", "--get", "maintenance.auto"), "false");

    writeFileSync(join(workspace, "protected.txt"), "changed\n");
    assert.throws(
      () => execFileSync("git", ["diff", "--exit-code", "--", "protected.txt"], { cwd: workspace, stdio: "pipe" }),
      (error) => error?.status === 1,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("ignores inherited command-scope Git configuration that enables hooks", () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-hostile-git-env-"));
  const workspace = join(root, "workspace");
  const hooks = join(root, "hooks");
  const sentinel = join(root, "hook-executed");
  const redirectedGitDirectory = join(root, "redirected.git");
  const redirectedWorkTree = join(root, "redirected-worktree");
  mkdirSync(workspace);
  mkdirSync(hooks);
  mkdirSync(redirectedWorkTree);
  const hook = join(hooks, "pre-commit");
  writeFileSync(hook, `#!/bin/sh\nprintf executed > "${sentinel}"\n`);
  chmodSync(hook, 0o755);
  const previous = {
    GIT_CONFIG_COUNT: process.env.GIT_CONFIG_COUNT,
    GIT_CONFIG_KEY_0: process.env.GIT_CONFIG_KEY_0,
    GIT_CONFIG_VALUE_0: process.env.GIT_CONFIG_VALUE_0,
    GIT_DIR: process.env.GIT_DIR,
    GIT_WORK_TREE: process.env.GIT_WORK_TREE,
  };
  try {
    process.env.GIT_CONFIG_COUNT = "1";
    process.env.GIT_CONFIG_KEY_0 = "core.hooksPath";
    process.env.GIT_CONFIG_VALUE_0 = hooks;
    process.env.GIT_DIR = redirectedGitDirectory;
    process.env.GIT_WORK_TREE = redirectedWorkTree;
    writeFileSync(join(workspace, "protected.txt"), "baseline\n");
    initializeBenchmarkWorkspaceRepository(workspace);

    assert.equal(existsSync(sentinel), false);
    assert.equal(existsSync(redirectedGitDirectory), false);
    assert.equal(git(workspace, "config", "--get", "core.hooksPath"), ".git/hooks-disabled");
    assert.equal(git(workspace, "rev-list", "--count", "HEAD"), "1");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("creates and commits the exact fixture plus selected project instructions", () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-workspace-"));
  try {
    const agents = join(root, "input-AGENTS.md");
    writeFileSync(agents, "# Project rules\n");
    const workspace = createBenchmarkWorkspace(
      root,
      "p",
      2,
      { id: "calculator", files: { "requirements.md": "build it\n" } },
      { projectInstructions: "compiled", projectInstructionsFile: agents },
    );

    assert.equal(readFileSync(join(workspace, "requirements.md"), "utf8"), "build it\n");
    assert.equal(readFileSync(join(workspace, "AGENTS.md"), "utf8"), "# Project rules\n");
    assert.equal(git(workspace, "status", "--porcelain"), "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function git(workspace, ...args) {
  return execFileSync("git", args, {
    cwd: workspace,
    encoding: "utf8",
    env: sanitizeBenchmarkGitEnvironment(),
  }).trim();
}
