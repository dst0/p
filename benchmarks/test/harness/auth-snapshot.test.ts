import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { createBenchmarkAgentDirectories } from "../../src/agents/private-directories.ts";
import { createEphemeralAuthSnapshot, verifyEphemeralAuthSnapshot } from "../../src/harness/auth-snapshot.ts";
import {
  consumeBenchmarkAuthSource,
  copyBenchmarkAuthSource,
  resolveBenchmarkAuthSource,
} from "../../src/harness/auth-source.ts";
import {
  benchmarkPrivateInputEnvironment,
  benchmarkPrivateInputEvidence,
  createBenchmarkPrivateInputSnapshots,
  verifyBenchmarkPrivateInputSnapshots,
} from "../../src/harness/private-input-snapshots.ts";

test("auth input is private, immutable from live rotation, and copied per cell", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-auth-live-"));
  const source = join(root, "auth.json");
  writeFileSync(source, '{"token":"initial"}\n', { mode: 0o600 });
  const snapshot = createEphemeralAuthSnapshot(source);
  const snapshotRoot = dirname(snapshot.path);
  try {
    assert.equal(snapshot.present, true);
    assert.equal(statSync(snapshotRoot).mode & 0o777, 0o700);
    assert.equal(statSync(snapshot.path).mode & 0o777, 0o600);
    assert.equal(verifyEphemeralAuthSnapshot(snapshot), true);
    const environment = benchmarkPrivateInputEnvironment(
      {
        auth: snapshot,
        models: { path: "unused", present: false, sha256: "unused", dispose() {} },
        dispose() {},
      },
      { MARKER: "kept", GIT_DIR: "/hostile/repository" },
    );
    assert.equal(environment.MARKER, "kept");
    assert.equal("GIT_DIR" in environment, false);
    assert.equal(resolveBenchmarkAuthSource(environment), snapshot.path);
    assert.equal(consumeBenchmarkAuthSource(environment), snapshot.path);
    assert.equal("P_BENCHMARK_AUTH_FILE" in environment, false);
    const firstCell = join(root, "cell-1", "auth.json");
    assert.equal(copyBenchmarkAuthSource(snapshot.path, firstCell), true);
    writeFileSync(firstCell, '{"token":"refreshed-in-cell"}\n');
    assert.equal(readFileSync(snapshot.path, "utf8"), '{"token":"initial"}\n');
    writeFileSync(source, '{"token":"rotated-live"}\n');
    const secondCell = join(root, "cell-2", "auth.json");
    assert.equal(copyBenchmarkAuthSource(snapshot.path, secondCell), true);
    assert.equal(readFileSync(secondCell, "utf8"), '{"token":"initial"}\n');
    assert.equal(statSync(secondCell).mode & 0o777, 0o600);
    assert.equal(verifyEphemeralAuthSnapshot(snapshot), true);
    assert.equal(JSON.stringify(snapshot).includes(snapshot.path), false);
  } finally {
    snapshot.dispose();
    assert.equal(existsSync(snapshotRoot), false);
    rmSync(root, { recursive: true, force: true });
  }
});

test("an absent auth input stays absent when the live file appears", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-auth-absent-"));
  const source = join(root, "auth.json");
  const snapshot = createEphemeralAuthSnapshot(source);
  try {
    assert.equal(snapshot.present, false);
    writeFileSync(source, '{"token":"appeared-live"}\n');
    const cell = join(root, "cell", "auth.json");
    assert.equal(copyBenchmarkAuthSource(snapshot.path, cell), false);
    assert.equal(existsSync(cell), false);
    assert.equal(verifyEphemeralAuthSnapshot(snapshot), true);
  } finally {
    snapshot.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});

test("private snapshot creation cleans earlier inputs when auth copying fails", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-private-input-failure-"));
  const models = join(root, "models.json");
  const invalidAuth = join(root, "auth-directory");
  const temporaryParent = join(root, "snapshots");
  writeFileSync(models, "{}\n");
  mkdirSync(invalidAuth);
  mkdirSync(temporaryParent);
  assert.throws(
    () => createBenchmarkPrivateInputSnapshots(models, invalidAuth, temporaryParent),
    /directory|operation not supported|copyfile/iu,
  );
  assert.deepEqual(readdirSync(temporaryParent), []);
  rmSync(root, { recursive: true, force: true });
});

test("combined private snapshots verify and dispose both inputs", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-private-inputs-"));
  const models = join(root, "models.json");
  const auth = join(root, "auth.json");
  writeFileSync(models, "{}\n");
  writeFileSync(auth, "{}\n");
  const snapshots = createBenchmarkPrivateInputSnapshots(models, auth);
  const roots = [dirname(snapshots.models.path), dirname(snapshots.auth.path)];
  assert.equal(verifyBenchmarkPrivateInputSnapshots(snapshots), true);
  const evidence = benchmarkPrivateInputEvidence(snapshots);
  assert.deepEqual(Object.keys(evidence).sort(), ["modelsFilePresent", "modelsFileSha256"]);
  assert.equal(JSON.stringify(evidence).includes(snapshots.auth.path), false);
  snapshots.dispose();
  assert.equal(
    roots.every((path) => !existsSync(path)),
    true,
  );
  rmSync(root, { recursive: true, force: true });
});

test("agent directory copies are writable locally and cleaned on success and failure", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-agent-directories-"));
  const auth = join(root, "auth.json");
  const temporaryParent = join(root, "agent-dirs");
  writeFileSync(auth, '{"token":"base"}\n');
  mkdirSync(temporaryParent);
  const directories = createBenchmarkAgentDirectories({ authFile: auth }, temporaryParent);
  assert.equal(statSync(directories.root).mode & 0o777, 0o700);
  writeFileSync(join(directories.dirs.p, "auth.json"), '{"token":"cell-refresh"}\n');
  assert.equal(readFileSync(auth, "utf8"), '{"token":"base"}\n');
  directories.dispose();
  assert.deepEqual(readdirSync(temporaryParent), []);
  const invalidConfig = join(root, "invalid-config-directory");
  mkdirSync(invalidConfig);
  assert.throws(
    () => createBenchmarkAgentDirectories({ authFile: auth, codexConfig: invalidConfig }, temporaryParent),
    /directory|operation not supported|copyfile/iu,
  );
  assert.deepEqual(readdirSync(temporaryParent), []);
  rmSync(root, { recursive: true, force: true });
});
