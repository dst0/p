import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServiceValues } from "./indexing-install-fallback.js";
import { isTemporaryDirectory, isUnderTemporaryRoot } from "./indexing-service-search-path.js";

const CPU_PLAN = {
  installAmdPhoenixIron: false,
  installAmdRyzenAi: false,
  installIntelOpenVino: false,
  ragDevice: "cpu",
};
const MISSING_DIRECTORY = "/nonexistent-p-indexing-service-path/bin";

function createFixtureRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-search-path-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function buildCpuServiceValues(runtime, venvPython = "/managed/venv/bin/python") {
  return buildServiceValues(CPU_PLAN, venvPython, runtime);
}

function servicePath(venvPython, searchEntries, isTemporary) {
  return buildCpuServiceValues(
    { execPath: process.execPath, searchPath: searchEntries.join(path.delimiter), isTemporary },
    venvPython,
  ).environment.PATH.split(path.delimiter);
}

test("drops empty, relative, missing, file, and temporary PATH entries while preserving order", (t) => {
  t.mock.method(console, "warn", () => {});
  const sessionBin = path.join(createFixtureRoot(t), "session", "bin");
  fs.mkdirSync(sessionBin, { recursive: true });

  const entries = servicePath("/managed/venv/bin/python", [
    "",
    path.relative(process.cwd(), "/bin"),
    "relative/bin",
    "/usr/bin",
    sessionBin,
    MISSING_DIRECTORY,
    "/bin/sh",
    "/bin",
    "/usr/bin/",
    ".",
    "/usr/bin",
  ]);

  assert.deepEqual(entries, ["/managed/venv/bin", "/usr/bin", "/bin"]);
});

test("keeps the managed venv first, absolute, and only once", (t) => {
  t.mock.method(console, "warn", () => {});
  const venvBin = path.join(createFixtureRoot(t), "agent", "indexing-service", "venv", "bin");
  fs.mkdirSync(venvBin, { recursive: true });
  const venvPython = path.join(venvBin, "python");

  assert.deepEqual(servicePath(venvPython, ["/usr/bin", venvBin, "/bin"], () => false), [venvBin, "/usr/bin", "/bin"]);
  assert.deepEqual(servicePath(venvPython, ["/usr/bin", venvBin, "/bin"]), [venvBin, "/usr/bin", "/bin"]);
  assert.deepEqual(servicePath(path.join("relative-agent", "venv", "bin", "python"), ["/usr/bin"]), [
    path.resolve("relative-agent", "venv", "bin"),
    "/usr/bin",
  ]);
});

test("defaults to the installing process PATH and executable", (t) => {
  t.mock.method(console, "warn", () => {});
  const originalPath = process.env.PATH;
  t.after(() => {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
  });
  process.env.PATH = ["/usr/bin", "relative/bin", "", "/bin", "/usr/bin/", MISSING_DIRECTORY].join(path.delimiter);

  const values = buildCpuServiceValues();

  assert.deepEqual(values.environment.PATH.split(path.delimiter), ["/managed/venv/bin", "/usr/bin", "/bin"]);
  assert.equal(values.node, buildCpuServiceValues({ execPath: process.execPath, searchPath: "/usr/bin:/bin" }).node);
  assert.equal(fs.realpathSync(values.node), fs.realpathSync(process.execPath));
  const partialRuntime = buildCpuServiceValues({ searchPath: "/bin" });
  assert.equal(partialRuntime.environment.PATH, ["/managed/venv/bin", "/bin"].join(path.delimiter));
  assert.equal(fs.realpathSync(partialRuntime.node), fs.realpathSync(process.execPath));
});


test("classifies system temporary roots and scratch path segments as temporary", () => {
  for (const directory of [
    "/tmp",
    "/tmp/p-session/bin",
    "/private/tmp/claude-501/scratchpad/bin",
    "/var/folders/jp/abc123/T/p-run/bin",
    "/private/var/folders/jp/abc123/T/bin",
    "/Users/dev/.codex/tmp/arg0/codex-arg0ab12",
    "/home/dev/AppData/Temp/bin",
  ]) {
    assert.equal(isTemporaryDirectory(directory), true, directory);
  }
  for (const directory of [
    "/usr/bin",
    "/opt/homebrew/bin",
    "/tmpfiles/bin",
    "/var/folders-archive/bin",
    "/home/dev/template/bin",
    "/home/dev/.tmp-cache/bin",
  ]) {
    assert.equal(isTemporaryDirectory(directory), false, directory);
  }
});

test("honors the configured temporary directory but never treats the filesystem root as temporary", (t) => {
  const originalTmpdir = process.env.TMPDIR;
  t.after(() => {
    if (originalTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = originalTmpdir;
  });

  process.env.TMPDIR = "/srv/p-scratch";
  assert.equal(isTemporaryDirectory("/srv/p-scratch/session/bin"), true);
  assert.equal(isTemporaryDirectory("/srv/p-other/bin"), false);
  process.env.TMPDIR = "/";
  assert.equal(isTemporaryDirectory("/usr/bin"), false);
  assert.equal(isTemporaryDirectory("/"), false);
  assert.equal(isUnderTemporaryRoot("/usr/bin", ["/"]), false);
  assert.equal(isUnderTemporaryRoot("/", ["/"]), false);
});

test("resolves symlinked PATH entries and temporary roots before comparing them", (t) => {
  const root = createFixtureRoot(t);
  fs.mkdirSync(path.join(root, "real", "bin"), { recursive: true });
  fs.mkdirSync(path.join(root, "other"), { recursive: true });
  fs.symlinkSync(path.join(root, "real"), path.join(root, "link"));

  assert.equal(isUnderTemporaryRoot(path.join(root, "link", "bin"), [path.join(root, "real")]), true);
  assert.equal(isUnderTemporaryRoot(path.join(root, "real", "bin"), [path.join(root, "link")]), true);
  assert.equal(isUnderTemporaryRoot(path.join(root, "link", "bin"), [path.join(root, "other")]), false);
  assert.equal(isUnderTemporaryRoot(path.join(root, "real-archive", "bin"), [path.join(root, "real")]), false);
});
