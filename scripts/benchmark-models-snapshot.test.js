import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  assertBenchmarkModelDefined,
  createEphemeralModelsSnapshot,
  verifyEphemeralModelsSnapshot,
} from "./benchmark-models-snapshot.js";

test("models configuration is snapshotted privately and independently of the live file", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-models-test-"));
  const live = join(root, "models.json");
  writeFileSync(live, '{"providers":{"test":{}}}\n');
  const snapshot = createEphemeralModelsSnapshot(live);
  try {
    assert.equal(statSync(snapshot.path).mode & 0o777, 0o600);
    assert.equal(verifyEphemeralModelsSnapshot(snapshot), true);
    writeFileSync(live, '{"providers":{"changed":{}}}\n');
    assert.equal(readFileSync(snapshot.path, "utf8"), '{"providers":{"test":{}}}\n');
    assert.equal(verifyEphemeralModelsSnapshot(snapshot), true);
  } finally {
    snapshot.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});

test("an absent models file remains explicitly absent for every cell", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-models-absent-test-"));
  const live = join(root, "models.json");
  const snapshot = createEphemeralModelsSnapshot(live);
  try {
    assert.equal(snapshot.present, false);
    assert.equal(existsSync(snapshot.path), false);
    assert.equal(verifyEphemeralModelsSnapshot(snapshot), true);
    writeFileSync(live, '{"providers":{"appeared":{}}}\n');
    assert.equal(existsSync(snapshot.path), false);
    assert.equal(verifyEphemeralModelsSnapshot(snapshot), true);
    writeFileSync(snapshot.path, "{}\n");
    assert.equal(verifyEphemeralModelsSnapshot(snapshot), false);
  } finally {
    snapshot.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});

test("paired benchmarks require exact model metadata in the immutable snapshot", () => {
  const root = mkdtempSync(join(tmpdir(), "benchmark-model-identity-test-"));
  const live = join(root, "models.json");
  writeFileSync(
    live,
    '{"providers":{"local":{"api":"openai-completions","models":[{"id":"known","contextWindow":65536,"maxTokens":8192}]}}}\n',
  );
  const snapshot = createEphemeralModelsSnapshot(live);
  try {
    assert.doesNotThrow(() => assertBenchmarkModelDefined(snapshot, "local/known"));
    assert.throws(() => assertBenchmarkModelDefined(snapshot, "local/custom"), /explicitly defined/u);
    assert.throws(() => assertBenchmarkModelDefined(snapshot, "missing/known"), /explicitly defined/u);
  } finally {
    snapshot.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});
