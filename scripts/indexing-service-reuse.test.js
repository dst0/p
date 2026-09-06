import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  assertIndexingServiceReuseDecisionCurrent,
  canReuseIndexingService,
  clearIndexingServiceReuseDecision,
  consumeIndexingServiceReuseDecision,
  consumeExpectedIndexingServiceReuseDecision,
  isIndexingServiceReuseDecisionCurrent,
  writeIndexingServiceReuseDecision,
} from "./indexing-service-reuse.js";

const indexingVersion = "a".repeat(64);
const runtimeConfigFingerprint = "b".repeat(64);
const runId = "reinstall-run-a";

const matching = {
  configuredDevice: "apple-ane",
  denseEmbeddings: true,
  health: {
    status: "ready",
    requestedBackend: "apple-ane",
    selectedBackend: "apple-coreai-ane",
    fallbackOccurred: false,
  },
  newIndexingVersion: "source-v1",
  newRuntimeConfigFingerprint: "config-v1",
  status: {
    pid: process.pid,
    running: true,
    indexingVersion: "source-v1",
    runtimeConfigFingerprint: "config-v1",
    repos: [{ state: "updating" }],
  },
};

test("reuses a healthy daemon only when code and runtime configuration match", () => {
  assert.equal(canReuseIndexingService(matching), true);
  assert.equal(
    canReuseIndexingService({ ...matching, newRuntimeConfigFingerprint: "config-v2" }),
    false,
  );
  assert.equal(canReuseIndexingService({ ...matching, newIndexingVersion: "source-v2" }), false);
});

test("restarts a dense daemon when its managed embedding backend is unavailable or changed", () => {
  assert.equal(canReuseIndexingService({ ...matching, health: undefined }), false);
  assert.equal(canReuseIndexingService({ ...matching, health: { ...matching.health, fallbackOccurred: true } }), false);
  assert.equal(
    canReuseIndexingService({ ...matching, health: { ...matching.health, selectedBackend: "cpu" } }),
    false,
  );
});

test("allows BM25-only reuse without an embedding server", () => {
  assert.equal(
    canReuseIndexingService({ ...matching, configuredDevice: undefined, denseEmbeddings: false, health: undefined }),
    true,
  );
});

test("allows a dense idle daemon to keep its embedding process stopped", () => {
  assert.equal(
    canReuseIndexingService({
      ...matching,
      health: undefined,
      status: { ...matching.status, repos: [{ state: "ready" }] },
    }),
    true,
  );
});

test("invalidates reuse when runtime configuration changes during installation", () => {
  assert.equal(
    isIndexingServiceReuseDecisionCurrent({
      decision: { formatVersion: 1, indexingVersion, runId, runtimeConfigFingerprint },
      currentIndexingVersion: indexingVersion,
      currentRuntimeConfigFingerprint: runtimeConfigFingerprint,
    }),
    true,
  );
  assert.equal(
    isIndexingServiceReuseDecisionCurrent({
      decision: { formatVersion: 1, indexingVersion, runId, runtimeConfigFingerprint },
      currentIndexingVersion: indexingVersion,
      currentRuntimeConfigFingerprint: "c".repeat(64),
    }),
    false,
  );
  assert.equal(
    isIndexingServiceReuseDecisionCurrent({
      decision: { formatVersion: 1, indexingVersion, runId, runtimeConfigFingerprint },
      currentIndexingVersion: "c".repeat(64),
      currentRuntimeConfigFingerprint: runtimeConfigFingerprint,
    }),
    false,
  );
});

test("writes and consumes a private one-shot reuse decision", () => {
  const agentDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-reuse-"));
  const markerPath = path.join(agentDirectory, "indexing-version-unchanged");
  try {
    writeIndexingServiceReuseDecision(agentDirectory, runId, indexingVersion, runtimeConfigFingerprint);

    assert.equal(fs.statSync(markerPath).mode & 0o777, 0o600);
    assert.deepEqual(consumeIndexingServiceReuseDecision(agentDirectory, runId), {
      formatVersion: 1,
      indexingVersion,
      runId,
      runtimeConfigFingerprint,
    });
    assert.equal(fs.existsSync(markerPath), false);
    assert.equal(consumeIndexingServiceReuseDecision(agentDirectory, runId), undefined);
  } finally {
    fs.rmSync(agentDirectory, { recursive: true, force: true });
  }
});

test("rejects and removes a malformed reuse decision", () => {
  const agentDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-reuse-"));
  const markerPath = path.join(agentDirectory, "indexing-version-unchanged");
  try {
    fs.writeFileSync(markerPath, "not-json\n", { mode: 0o600 });
    assert.throws(
      () => consumeIndexingServiceReuseDecision(agentDirectory, runId),
      /Invalid indexing service reuse decision/,
    );
    assert.equal(fs.existsSync(markerPath), false);
  } finally {
    fs.rmSync(agentDirectory, { recursive: true, force: true });
  }
});

test("does not let another reinstall consume an owner-bound reuse decision", () => {
  const agentDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-reuse-"));
  const markerPath = path.join(agentDirectory, "indexing-version-unchanged");
  try {
    writeIndexingServiceReuseDecision(agentDirectory, runId, indexingVersion, runtimeConfigFingerprint);
    assert.throws(
      () => consumeIndexingServiceReuseDecision(agentDirectory, "reinstall-run-b"),
      /belongs to another reinstall run/,
    );
    assert.equal(fs.existsSync(markerPath), true);
    assert.equal(consumeIndexingServiceReuseDecision(agentDirectory, runId)?.runId, runId);
  } finally {
    fs.rmSync(agentDirectory, { recursive: true, force: true });
  }
});

test("fails closed when an expected reuse decision is missing or stale", () => {
  const agentDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-reuse-"));
  try {
    assert.throws(
      () =>
        consumeExpectedIndexingServiceReuseDecision({
          agentDir: agentDirectory,
          currentIndexingVersion: indexingVersion,
          currentRuntimeConfigFingerprint: runtimeConfigFingerprint,
          expectedReuse: "reuse",
          expectedRunId: runId,
        }),
      /became stale/,
    );
    writeIndexingServiceReuseDecision(agentDirectory, runId, indexingVersion, runtimeConfigFingerprint);
    assert.throws(
      () =>
        consumeExpectedIndexingServiceReuseDecision({
          agentDir: agentDirectory,
          currentIndexingVersion: indexingVersion,
          currentRuntimeConfigFingerprint: "c".repeat(64),
          expectedReuse: "reuse",
          expectedRunId: runId,
        }),
      /became stale/,
    );
    assert.equal(fs.existsSync(path.join(agentDirectory, "indexing-version-unchanged")), false);
    assert.equal(
      assertIndexingServiceReuseDecisionCurrent({
        decision: undefined,
        currentIndexingVersion: indexingVersion,
        currentRuntimeConfigFingerprint: runtimeConfigFingerprint,
      }),
      false,
    );
  } finally {
    fs.rmSync(agentDirectory, { recursive: true, force: true });
  }
});
