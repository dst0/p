import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServiceValues } from "./indexing-install-fallback.js";
import { isVersionScopedPath } from "./indexing-service-node-executable.js";
import { renderLaunchdPlist, renderSystemdUnit } from "./install-indexing-service.js";

const CPU_PLAN = {
  installAmdPhoenixIron: false,
  installAmdRyzenAi: false,
  installIntelOpenVino: false,
  ragDevice: "cpu",
};
const VENV_PYTHON = "/managed/venv/bin/python";

// Fixtures live under os.tmpdir(); the temporary-directory PATH policy has its own suite.
const keepFixtureDirectories = () => false;

function createFixtureRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-node-executable-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(isVersionScopedPath(root), false, `fixture root ${root} looks version-scoped; use a plain TMPDIR`);
  return root;
}

function writeExecutable(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return filePath;
}

function createSymlink(linkPath, target) {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(target, linkPath);
  return linkPath;
}

function createHomebrewNode(root, version = "26.8.1") {
  const prefix = path.join(root, "homebrew");
  const cellarNode = writeExecutable(path.join(prefix, "Cellar", "node", version, "bin", "node"));
  createSymlink(path.join(prefix, "bin", "node"), path.join("..", "Cellar", "node", version, "bin", "node"));
  return { prefix, cellarNode, binDirectory: path.join(prefix, "bin") };
}

function resolveServiceNode(execPath, searchDirectories) {
  return buildServiceValues(CPU_PLAN, VENV_PYTHON, {
    execPath,
    searchPath: searchDirectories.join(path.delimiter),
    isTemporary: keepFixtureDirectories,
  }).node;
}

test("launches the Homebrew bin link instead of the versioned Cellar binary", (t) => {
  t.mock.method(console, "warn", () => {});
  const homebrew = createHomebrewNode(createFixtureRoot(t));
  const stableNode = path.join(homebrew.binDirectory, "node");

  const values = buildServiceValues(CPU_PLAN, VENV_PYTHON, {
    execPath: homebrew.cellarNode,
    searchPath: homebrew.binDirectory,
    isTemporary: keepFixtureDirectories,
  });

  assert.equal(values.node, stableNode);
  const plist = renderLaunchdPlist(values);
  assert.ok(plist.includes(`<string>${stableNode}</string>\n        <string>${values.daemon}</string>`));
  assert.ok(!plist.includes("Cellar"), "launchd must not pin the versioned Cellar path");
  const unit = renderSystemdUnit(values);
  assert.ok(unit.includes(`ExecStart="${stableNode}" "${values.daemon}"`));
  assert.ok(!unit.includes("Cellar"), "systemd must not pin the versioned Cellar path");
  assert.equal(console.warn.mock.callCount(), 0);
});

test("ignores PATH nodes that resolve to a different binary and keeps PATH order", (t) => {
  t.mock.method(console, "warn", () => {});
  const root = createFixtureRoot(t);
  const homebrew = createHomebrewNode(root);
  const olderNode = writeExecutable(path.join(homebrew.prefix, "Cellar", "node", "25.9.0", "bin", "node"));
  createSymlink(path.join(root, "usr-local", "bin", "node"), olderNode);
  const copiedNode = path.join(root, "copied", "bin", "node");
  fs.mkdirSync(path.dirname(copiedNode), { recursive: true });
  fs.copyFileSync(homebrew.cellarNode, copiedNode);
  createSymlink(path.join(homebrew.prefix, "opt", "node"), path.join("..", "Cellar", "node", "26.8.1"));
  const optBin = path.join(homebrew.prefix, "opt", "node", "bin");

  const node = resolveServiceNode(homebrew.cellarNode, [
    path.join(root, "usr-local", "bin"),
    path.dirname(copiedNode),
    optBin,
    homebrew.binDirectory,
  ]);

  assert.equal(node, path.join(optBin, "node"));
});

test("falls back to the running executable and warns when no stable PATH node matches it", (t) => {
  t.mock.method(console, "warn", () => {});
  const root = createFixtureRoot(t);
  const homebrew = createHomebrewNode(root);
  const otherNode = writeExecutable(path.join(root, "other", "Cellar", "node", "24.1.0", "bin", "node"));
  createSymlink(path.join(root, "other", "bin", "node"), otherNode);
  fs.mkdirSync(path.join(root, "empty", "bin"), { recursive: true });

  const node = resolveServiceNode(homebrew.cellarNode, [path.join(root, "empty", "bin"), path.join(root, "other", "bin")]);

  assert.equal(node, homebrew.cellarNode);
  assert.equal(console.warn.mock.callCount(), 1);
  assert.match(String(console.warn.mock.calls[0].arguments[0]), /version-scoped Node/);
  assert.ok(String(console.warn.mock.calls[0].arguments[0]).includes(homebrew.cellarNode));
});

test("skips version-scoped and shell-session links even when they resolve to the running executable", (t) => {
  t.mock.method(console, "warn", () => {});
  const root = createFixtureRoot(t);
  const homebrew = createHomebrewNode(root);
  const nvmBin = path.dirname(
    createSymlink(path.join(root, "nvm", "versions", "node", "v26.8.1", "bin", "node"), homebrew.cellarNode),
  );
  const fnmBin = path.dirname(
    createSymlink(path.join(root, "state", "fnm_multishells", "4242_1758600000000", "bin", "node"), homebrew.cellarNode),
  );
  const unstableDirectories = [nvmBin, fnmBin, path.dirname(homebrew.cellarNode)];

  assert.equal(resolveServiceNode(homebrew.cellarNode, [...unstableDirectories, homebrew.binDirectory]),
    path.join(homebrew.binDirectory, "node"));
  assert.equal(console.warn.mock.callCount(), 0);
  assert.equal(resolveServiceNode(homebrew.cellarNode, unstableDirectories), homebrew.cellarNode);
  assert.equal(console.warn.mock.callCount(), 1);
});

test("keeps the running executable when it can no longer be resolved", (t) => {
  t.mock.method(console, "warn", () => {});
  const root = createFixtureRoot(t);
  const homebrew = createHomebrewNode(root);
  const removedNode = path.join(homebrew.prefix, "Cellar", "node", "26.7.0", "bin", "node");
  const brokenLink = createSymlink(path.join(root, "broken", "bin", "node"), path.join(root, "missing", "node"));

  assert.equal(resolveServiceNode(removedNode, [path.dirname(brokenLink), homebrew.binDirectory]), removedNode);
});

test("treats Homebrew HEAD Cellar builds as version-scoped", (t) => {
  t.mock.method(console, "warn", () => {});
  const root = createFixtureRoot(t);
  const homebrew = createHomebrewNode(root, "HEAD-1a2b3c4");
  const cellarBin = path.dirname(homebrew.cellarNode);

  assert.equal(resolveServiceNode(homebrew.cellarNode, [cellarBin, homebrew.binDirectory]),
    path.join(homebrew.binDirectory, "node"));
  assert.equal(console.warn.mock.callCount(), 0);
  assert.equal(resolveServiceNode(homebrew.cellarNode, [cellarBin]), homebrew.cellarNode);
  assert.equal(console.warn.mock.callCount(), 1);
});

test("classifies release-, session-, and revision-scoped Node paths", () => {
  for (const filePath of [
    "/opt/homebrew/Cellar/node/26.8.1/bin/node",
    "/opt/homebrew/Cellar/node/HEAD-1a2b3c4/bin/node",
    "/Users/dev/.nvm/versions/node/v24.18.0/bin/node",
    "/opt/tools/node-22.1/bin/node",
    "/Users/dev/.local/state/fnm_multishells/4242_1758600000000/bin/node",
    "/snap/node/10312/bin/node",
  ]) {
    assert.equal(isVersionScopedPath(filePath), true, filePath);
  }
  for (const filePath of [
    "/opt/homebrew/bin/node",
    "/opt/homebrew/opt/node@22/bin/node",
    "/usr/local/bin/node",
    "/home/linuxbrew/.linuxbrew/bin/node",
    "/snap/node/current/bin/node",
    "/snap/bin/node",
    "/snap/node",
  ]) {
    assert.equal(isVersionScopedPath(filePath), false, filePath);
  }
});

test("does not warn for an unversioned running executable", (t) => {
  t.mock.method(console, "warn", () => {});
  const root = createFixtureRoot(t);
  const systemNode = writeExecutable(path.join(root, "usr", "bin", "node"));

  assert.equal(resolveServiceNode(systemNode, [path.join(root, "usr", "bin")]), systemNode);
  assert.equal(resolveServiceNode(systemNode, []), systemNode);
  assert.equal(console.warn.mock.callCount(), 0);
});
