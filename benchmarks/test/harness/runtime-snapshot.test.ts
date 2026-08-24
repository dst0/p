import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertEmptyOutputDirectory,
  benchmarkProjectInstructionProbePath,
  benchmarkRunnerPath,
  benchmarkSeedHelperPath,
  createRuntimeSnapshot,
  hashRuntimeSnapshot,
  snapshotBenchmarkRunnerClosure,
} from "../../src/harness/runtime-snapshot.ts";

const runtimePackages = ["ai", "tui", "agent", "code-index", "coding-agent", "site"];
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

function writeRuntimeFixture(root: string): void {
  mkdirSync(join(root, "node_modules", "dependency"), { recursive: true });
  writeFileSync(join(root, "node_modules", "dependency", "index.js"), "export {};\n");
  const sourceRoot = join(root, "benchmarks", "src");
  mkdirSync(join(sourceRoot, "harness"), { recursive: true });
  mkdirSync(join(sourceRoot, "project-instructions"), { recursive: true });
  writeFileSync(join(sourceRoot, "harness", "helper.ts"), 'export const value = "snapshot";\n');
  writeFileSync(join(sourceRoot, "harness", "seed-helper-process.ts"), "export {};\n");
  writeFileSync(
    join(sourceRoot, "run-agents.ts"),
    'import { value } from "./harness/helper.ts"; process.stdout.write(value);\n',
  );
  writeFileSync(join(sourceRoot, "run-project-instructions.ts"), "export {};\n");
  writeFileSync(join(sourceRoot, "project-instructions", "probe.ts"), "process.stdout.write('probe snapshot');\n");
  writeFileSync(join(sourceRoot, "project-instructions", "seed.ts"), "process.stdout.write('seed snapshot');\n");
  for (const pkg of runtimePackages) {
    mkdirSync(join(root, "packages", pkg, "dist"), { recursive: true });
    writeFileSync(join(root, "packages", pkg, "package.json"), `${JSON.stringify({ name: pkg })}\n`);
    writeFileSync(join(root, "packages", pkg, "dist", "index.js"), "export {};\n");
  }
  const fixture = join(root, "benchmarks", "fixtures", "task");
  mkdirSync(fixture, { recursive: true });
  writeFileSync(join(fixture, "requirements.md"), "snapshot requirements\n");
  mkdirSync(join(root, "benchmarks", "test"), { recursive: true });
  mkdirSync(join(root, "benchmarks", "results"), { recursive: true });
  writeFileSync(join(root, "benchmarks", "test", "ignored.test.ts"), "ignored\n");
  writeFileSync(join(root, "benchmarks", "results", "ignored.json"), "ignored\n");
  writeFileSync(join(root, "package.json"), '{"type":"module"}\n');
  writeFileSync(join(root, "package-lock.json"), "{}\n");
}

test("snapshot executes copied TypeScript and remains immutable from live source and fixture changes", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-runtime-source-"));
  const snapshotParent = mkdtempSync(join(tmpdir(), "benchmark-runtime-copy-"));
  try {
    writeRuntimeFixture(root);
    const snapshot = createRuntimeSnapshot(root, snapshotParent);
    const fingerprint = hashRuntimeSnapshot(snapshot, process.execPath);
    assert.equal(benchmarkRunnerPath(snapshot), join(snapshot, "benchmarks", "src", "run-agents.ts"));
    assert.equal(
      benchmarkSeedHelperPath(snapshot),
      join(snapshot, "benchmarks", "src", "project-instructions", "seed.ts"),
    );
    assert.equal(existsSync(benchmarkProjectInstructionProbePath(snapshot)), true);
    assert.equal(existsSync(join(snapshot, "benchmarks", "test")), false);
    assert.equal(existsSync(join(snapshot, "benchmarks", "results")), false);

    writeFileSync(join(root, "benchmarks", "src", "harness", "helper.ts"), 'export const value = "live";\n');
    writeFileSync(join(root, "benchmarks", "fixtures", "task", "requirements.md"), "live fixture\n");
    assert.equal(hashRuntimeSnapshot(snapshot, process.execPath), fingerprint);
    assert.equal(
      readFileSync(join(snapshot, "benchmarks", "fixtures", "task", "requirements.md"), "utf8"),
      "snapshot requirements\n",
    );

    for (const [path, expected] of [
      [benchmarkRunnerPath(snapshot), "snapshot"],
      [benchmarkSeedHelperPath(snapshot), "seed snapshot"],
      [benchmarkProjectInstructionProbePath(snapshot), "probe snapshot"],
    ] as const) {
      const execution = spawnSync(process.execPath, [path], { encoding: "utf8" });
      assert.equal(execution.status, 0, execution.stderr);
      assert.equal(execution.stdout, expected);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(snapshotParent, { recursive: true, force: true });
  }
});

test("new snapshots fingerprint source and fixture bytes but exclude tests and historical results", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-runtime-fingerprint-"));
  const snapshotParent = mkdtempSync(join(tmpdir(), "benchmark-runtime-fingerprint-copy-"));
  try {
    writeRuntimeFixture(root);
    const fingerprint = (): string => {
      const snapshot = createRuntimeSnapshot(root, snapshotParent);
      try {
        return hashRuntimeSnapshot(snapshot, process.execPath);
      } finally {
        rmSync(snapshot, { recursive: true, force: true });
      }
    };
    const initial = fingerprint();
    writeFileSync(join(root, "benchmarks", "src", "harness", "helper.ts"), 'export const value = "changed";\n');
    const sourceChanged = fingerprint();
    assert.notEqual(sourceChanged, initial);
    writeFileSync(join(root, "benchmarks", "fixtures", "task", "requirements.md"), "changed fixture\n");
    const fixtureChanged = fingerprint();
    assert.notEqual(fixtureChanged, sourceChanged);
    writeFileSync(join(root, "benchmarks", "test", "ignored.test.ts"), "changed test\n");
    writeFileSync(join(root, "benchmarks", "results", "ignored.json"), "changed result\n");
    assert.equal(fingerprint(), fixtureChanged);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(snapshotParent, { recursive: true, force: true });
  }
});

test("source closure accepts only in-root TypeScript and approved built-package JavaScript", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-runtime-closure-"));
  const snapshotParent = mkdtempSync(join(tmpdir(), "benchmark-runtime-closure-copy-"));
  try {
    writeRuntimeFixture(root);
    writeFileSync(
      join(root, "benchmarks", "src", "harness", "helper.ts"),
      'export { value } from "../../../packages/coding-agent/dist/index.js";\n',
    );
    const snapshot = createRuntimeSnapshot(root, snapshotParent);
    rmSync(snapshot, { recursive: true, force: true });
    writeFileSync(join(root, "outside.ts"), "export interface Outside {}\n");
    writeFileSync(
      join(root, "benchmarks", "src", "run-agents.ts"),
      'import type { Outside } from "../../outside.ts"; export type Local = Outside;\n',
    );
    const typeOnlySnapshot = createRuntimeSnapshot(root, snapshotParent);
    assert.equal(existsSync(join(typeOnlySnapshot, "outside.ts")), false);
    rmSync(typeOnlySnapshot, { recursive: true, force: true });
    writeFileSync(join(root, "benchmarks", "src", "run-agents.ts"), 'import "../../outside.ts";\n');
    assert.throws(() => createRuntimeSnapshot(root, snapshotParent), /escapes or is missing from benchmarks\/src/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(snapshotParent, { recursive: true, force: true });
  }
});

test("runtime snapshot rejects escaping, nested, and unresolved symlinks", () => {
  for (const targetKind of ["relative", "nested", "unresolved"] as const) {
    const root = mkdtempSync(join(tmpdir(), "benchmark-runtime-symlink-source-"));
    const snapshotParent = mkdtempSync(join(tmpdir(), "benchmark-runtime-symlink-copy-"));
    try {
      writeRuntimeFixture(root);
      const dependency = join(root, "node_modules", "dependency");
      let target = "../../../outside-runtime";
      if (targetKind === "nested") {
        symlinkSync(join(root, "packages", "coding-agent"), join(dependency, "inner"));
        target = "inner";
      }
      if (targetKind === "unresolved") target = "../../packages/missing";
      symlinkSync(target, join(dependency, "escape"));
      assert.throws(
        () => createRuntimeSnapshot(root, snapshotParent),
        /Runtime symlink (?:escapes|is unresolved inside|resolves outside) immutable runtime snapshot/u,
      );
      assert.deepEqual(readdirSync(snapshotParent), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(snapshotParent, { recursive: true, force: true });
    }
  }
});

test("paired output must be absent or empty", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-output-check-"));
  try {
    assert.doesNotThrow(() => assertEmptyOutputDirectory(join(root, "missing")));
    assert.doesNotThrow(() => assertEmptyOutputDirectory(root));
    writeFileSync(join(root, "stale.json"), "{}\n");
    assert.throws(() => assertEmptyOutputDirectory(root), /not empty/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the real TypeScript benchmark closure can be snapshotted", () => {
  const snapshot = mkdtempSync(join(tmpdir(), "benchmark-real-runner-copy-"));
  try {
    snapshotBenchmarkRunnerClosure(repoRoot, snapshot);
    for (const path of [
      "run-agents.ts",
      "run-project-instructions.ts",
      "agents/private-directories.ts",
      "harness/auth-source.ts",
      "harness/candidate-registry.ts",
      "harness/runtime-snapshot.ts",
      "project-instructions/probe.ts",
      "project-instructions/seed.ts",
    ]) {
      assert.equal(existsSync(join(snapshot, "benchmarks", "src", path)), true, path);
    }
  } finally {
    rmSync(snapshot, { recursive: true, force: true });
  }
});
