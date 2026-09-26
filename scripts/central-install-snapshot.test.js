import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const helper = path.join(import.meta.dirname, "central-install-snapshot.js");
const reinstall = path.resolve(import.meta.dirname, "..", "reinstall.sh");

function git(root, ...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixture(context) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "p-central-install-test-")));
  const source = path.join(root, "source");
  const home = path.join(root, "home");
  fs.mkdirSync(source);
  fs.mkdirSync(home);
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(source, "-c", "init.defaultBranch=main", "init", "-q");
  fs.writeFileSync(path.join(source, "reinstall.sh"), "#!/bin/sh\nexit 0\n");
  fs.writeFileSync(path.join(source, "package.json"), '{"name":"p-monorepo","version":"5.0.2"}\n');
  git(source, "add", "reinstall.sh", "package.json");
  git(source, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "-qm", "Initial");
  return { root, source, home, install: path.join(home, ".p", "install") };
}

function run(home, ...args) {
  return spawnSync(process.execPath, [helper, ...args], {
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  });
}

function stage(fixtureRoot) {
  const result = run(fixtureRoot.home, "stage", fixtureRoot.source);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function finishBuild(state, runtime) {
  const dist = path.join(runtime, "packages", "coding-agent", "dist");
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, "cli.js"), "#!/usr/bin/env node\n");
  const result = run(state.home, "mark-built", runtime);
  assert.equal(result.status, 0, result.stderr);
}

test("stages only a clean committed source outside the checkout without activating it", (context) => {
  const state = fixture(context);
  fs.writeFileSync(path.join(state.source, "ignored-local-note"), "must not leak");
  git(state.source, "config", "--local", "status.showUntrackedFiles", "no");

  const rejected = run(state.home, "stage", state.source);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /clean|untracked/i);
  assert.equal(fs.existsSync(path.join(state.install, "current")), false);

  fs.rmSync(path.join(state.source, "ignored-local-note"));
  const runtime = stage(state);
  assert.ok(runtime.startsWith(path.join(state.install, "versions") + path.sep));
  assert.equal(fs.readFileSync(path.join(runtime, ".p-source-sha"), "utf8").trim(), git(state.source, "rev-parse", "HEAD"));
  assert.equal(fs.readFileSync(path.join(runtime, "reinstall.sh"), "utf8"), "#!/bin/sh\nexit 0\n");
  assert.equal(fs.existsSync(path.join(runtime, ".git")), false);
  assert.equal(fs.existsSync(path.join(state.install, "current")), false);
});

test("activation records the previous runtime and same-SHA reinstalls stage separately", (context) => {
  const state = fixture(context);
  const first = stage(state);
  assert.notEqual(run(state.home, "activate", first).status, 0);
  finishBuild(state, first);
  const firstActivation = run(state.home, "activate", first);
  assert.equal(firstActivation.status, 0, firstActivation.stderr);
  assert.equal(fs.realpathSync(path.join(state.install, "current")), first);
  const sameShaCandidate = stage(state);
  assert.notEqual(sameShaCandidate, first);
  assert.equal(fs.realpathSync(path.join(state.install, "current")), first);
  assert.equal(fs.existsSync(path.join(sameShaCandidate, ".p-runtime-built")), false);

  fs.writeFileSync(path.join(state.source, "next.txt"), "next version\n");
  git(state.source, "add", "next.txt");
  git(state.source, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "-qm", "Next");
  const second = stage(state);
  assert.notEqual(second, first);
  assert.equal(fs.realpathSync(path.join(state.install, "current")), first);
  finishBuild(state, second);
  const secondActivation = run(state.home, "activate", second);
  assert.equal(secondActivation.status, 0, secondActivation.stderr);
  assert.equal(fs.realpathSync(path.join(state.install, "current")), second);
  assert.equal(fs.realpathSync(path.join(state.install, "previous")), first);

  const pointerOnlyRollback = run(state.home, "rollback");
  assert.notEqual(pointerOnlyRollback.status, 0);
  assert.equal(fs.realpathSync(path.join(state.install, "current")), second);
  assert.equal(fs.realpathSync(path.join(state.install, "previous")), first);
});

test("activation rejects a foreign directory without changing current", (context) => {
  const state = fixture(context);
  const runtime = stage(state);
  finishBuild(state, runtime);
  assert.equal(run(state.home, "activate", runtime).status, 0);
  const foreign = path.join(state.root, "foreign");
  fs.mkdirSync(foreign);
  fs.writeFileSync(path.join(foreign, ".p-source-sha"), git(state.source, "rev-parse", "HEAD"));

  const result = run(state.home, "activate", foreign);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /versions|runtime/i);
  assert.equal(fs.realpathSync(path.join(state.install, "current")), runtime);
});

test("reinstall delegates before changing agent state and activates only after service health", () => {
  const script = fs.readFileSync(reinstall, "utf8");
  const staged = script.indexOf('central-install-snapshot.js" stage');
  const globalLock = script.indexOf('begin_central_install_transaction "$CENTRAL_INSTALL_ROOT"');
  const lock = script.indexOf('begin_indexing_reinstall_transaction "$AGENT_DIR"');
  const installedGlobalLock = script.lastIndexOf('begin_central_install_transaction "$CENTRAL_INSTALL_ROOT"');
  const installedAgentLock = script.lastIndexOf('begin_indexing_reinstall_transaction "$AGENT_DIR"');
  const health = script.indexOf('node scripts/indexing-service-health.js "$AGENT_DIR"');
  const activated = script.indexOf('central-install-snapshot.js activate "$SCRIPT_DIR"');
  assert.match(script, /trap finish_reinstall_transaction EXIT/);
  assert.ok(globalLock > 0 && globalLock < lock && lock < staged);
  assert.ok(installedGlobalLock > staged && installedGlobalLock < installedAgentLock && installedAgentLock < health);
  assert.ok(health > lock && health < activated);
  assert.match(script, /run_centralized_install_candidate "\$STAGED_RUNTIME" "\$PREVIOUS_RUNTIME" "\$@"/);
});

test("a symlinked install root is rejected without writing through it", (context) => {
  const state = fixture(context);
  const external = path.join(state.root, "external");
  fs.mkdirSync(path.join(state.home, ".p"));
  fs.mkdirSync(external);
  fs.symlinkSync(external, state.install);

  const result = run(state.home, "prepare");
  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(path.join(external, "versions")), false);
});

test("writable home and .p parents are rejected before install staging", (context) => {
  const state = fixture(context);
  fs.chmodSync(state.home, 0o777);
  const homeResult = run(state.home, "prepare");
  assert.notEqual(homeResult.status, 0);
  assert.equal(fs.existsSync(state.install), false);

  fs.chmodSync(state.home, 0o700);
  const pParent = path.join(state.home, ".p");
  fs.mkdirSync(pParent, { mode: 0o777 });
  fs.chmodSync(pParent, 0o777);
  const parentResult = run(state.home, "prepare");
  assert.notEqual(parentResult.status, 0);
  assert.equal(fs.existsSync(state.install), false);
});

test("a foreign previous pointer fails before staging another runtime", (context) => {
  const state = fixture(context);
  const first = stage(state);
  finishBuild(state, first);
  assert.equal(run(state.home, "activate", first).status, 0);
  const foreign = path.join(state.root, "foreign");
  fs.mkdirSync(foreign);
  fs.symlinkSync(foreign, path.join(state.install, "previous"));
  const before = fs.readdirSync(path.join(state.install, "versions")).length;

  const result = run(state.home, "stage", state.source);
  assert.notEqual(result.status, 0);
  assert.equal(fs.readdirSync(path.join(state.install, "versions")).length, before);
  assert.equal(fs.realpathSync(path.join(state.install, "current")), first);
});
