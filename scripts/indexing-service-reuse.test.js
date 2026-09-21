import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { do_writeStatus } from "../packages/coding-agent/src/core/indexing-daemon/indexingdaemon-methods/status-logging.ts";
import {
  assertIndexingServiceReuseDecisionCurrent,
  canReuseIndexingService,
  clearIndexingServiceReuseDecision,
  consumeIndexingServiceReuseDecision,
  consumeExpectedIndexingServiceReuseDecision,
  getIndexingRuntimeProvenance,
  isIndexingServiceReuseDecisionCurrent,
  writeIndexingServiceReuseDecision,
} from "./indexing-service-reuse.js";

const indexingVersion = "a".repeat(64);
const runtimeConfigFingerprint = "b".repeat(64);
const runId = "reinstall-run-a";
const runtimeProvenance = {
  daemonPath: "/opt/p-current/packages/coding-agent/dist/indexing-service-daemon.js",
  runtimeRoot: "/opt/p-current",
};

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
  newRuntimeProvenance: runtimeProvenance,
  status: {
    pid: process.pid,
    running: true,
    indexingVersion: "source-v1",
    runtimeConfigFingerprint: "config-v1",
    runtimeProvenance,
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

test("restarts a healthy daemon from a different canonical runtime", () => {
  assert.equal(
    canReuseIndexingService({
      ...matching,
      newRuntimeProvenance: {
        daemonPath: "/opt/p-next/packages/coding-agent/dist/indexing-service-daemon.js",
        runtimeRoot: "/opt/p-next",
      },
    }),
    false,
  );
  assert.equal(
    canReuseIndexingService({ ...matching, status: { ...matching.status, runtimeProvenance: undefined } }),
    false,
  );
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
      decision: { formatVersion: 2, indexingVersion, runId, runtimeConfigFingerprint, runtimeProvenance },
      currentIndexingVersion: indexingVersion,
      currentRuntimeConfigFingerprint: runtimeConfigFingerprint,
      currentRuntimeProvenance: runtimeProvenance,
    }),
    true,
  );
  assert.equal(
    isIndexingServiceReuseDecisionCurrent({
      decision: { formatVersion: 2, indexingVersion, runId, runtimeConfigFingerprint, runtimeProvenance },
      currentIndexingVersion: indexingVersion,
      currentRuntimeConfigFingerprint: "c".repeat(64),
      currentRuntimeProvenance: runtimeProvenance,
    }),
    false,
  );
  assert.equal(
    isIndexingServiceReuseDecisionCurrent({
      decision: { formatVersion: 2, indexingVersion, runId, runtimeConfigFingerprint, runtimeProvenance },
      currentIndexingVersion: "c".repeat(64),
      currentRuntimeConfigFingerprint: runtimeConfigFingerprint,
      currentRuntimeProvenance: runtimeProvenance,
    }),
    false,
  );
  assert.equal(
    isIndexingServiceReuseDecisionCurrent({
      decision: { formatVersion: 2, indexingVersion, runId, runtimeConfigFingerprint, runtimeProvenance },
      currentIndexingVersion: indexingVersion,
      currentRuntimeConfigFingerprint: runtimeConfigFingerprint,
      currentRuntimeProvenance: {
        daemonPath: "/opt/p-next/packages/coding-agent/dist/indexing-service-daemon.js",
        runtimeRoot: "/opt/p-next",
      },
    }),
    false,
  );
});

test("writes and consumes a private one-shot reuse decision", () => {
  const agentDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-reuse-"));
  const markerPath = path.join(agentDirectory, "indexing-version-unchanged");
  try {
    writeIndexingServiceReuseDecision(agentDirectory, runId, indexingVersion, runtimeConfigFingerprint, runtimeProvenance);

    assert.equal(fs.statSync(markerPath).mode & 0o777, 0o600);
    assert.deepEqual(consumeIndexingServiceReuseDecision(agentDirectory, runId), {
      formatVersion: 2,
      indexingVersion,
      runId,
      runtimeConfigFingerprint,
      runtimeProvenance,
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
    writeIndexingServiceReuseDecision(agentDirectory, runId, indexingVersion, runtimeConfigFingerprint, runtimeProvenance);
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
          currentRuntimeProvenance: runtimeProvenance,
          expectedReuse: "reuse",
          expectedRunId: runId,
        }),
      /became stale/,
    );
    writeIndexingServiceReuseDecision(agentDirectory, runId, indexingVersion, runtimeConfigFingerprint, runtimeProvenance);
    assert.throws(
      () =>
        consumeExpectedIndexingServiceReuseDecision({
          agentDir: agentDirectory,
          currentIndexingVersion: indexingVersion,
          currentRuntimeConfigFingerprint: "c".repeat(64),
          currentRuntimeProvenance: runtimeProvenance,
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
        currentRuntimeProvenance: runtimeProvenance,
      }),
      false,
    );
  } finally {
    fs.rmSync(agentDirectory, { recursive: true, force: true });
  }
});

test("rejects status written by a daemon from another canonical runtime", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-runtime-"));
  const oldRuntimeRoot = path.join(fixtureRoot, "old-runtime");
  const currentRuntimeRoot = path.join(fixtureRoot, "current-runtime");
  const linkedOldRuntimeRoot = path.join(fixtureRoot, "linked-old-runtime");
  const agentDirectory = path.join(fixtureRoot, "agent");
  const daemonRelativePath = path.join("packages", "coding-agent", "dist", "indexing-service-daemon.js");
  const oldDaemonPath = path.join(oldRuntimeRoot, daemonRelativePath);
  const currentDaemonPath = path.join(currentRuntimeRoot, daemonRelativePath);
  try {
    for (const daemonPath of [oldDaemonPath, currentDaemonPath]) {
      fs.mkdirSync(path.dirname(daemonPath), { recursive: true });
      fs.writeFileSync(daemonPath, "export {};\n");
    }
    fs.symlinkSync(oldRuntimeRoot, linkedOldRuntimeRoot, "dir");
    const originalArgv1 = process.argv[1];
    try {
      process.argv[1] = path.join(linkedOldRuntimeRoot, daemonRelativePath);
      do_writeStatus({
        disposed: false,
        indexingVersion: "source-v1",
        options: { agentDir: agentDirectory },
        runtimeConfigFingerprint: "config-v1",
        runtimes: new Map(),
        startedAt: new Date().toISOString(),
      });
    } finally {
      process.argv[1] = originalArgv1;
    }
    const status = JSON.parse(fs.readFileSync(path.join(agentDirectory, "indexing-service-status.json"), "utf8"));
    assert.deepEqual(
      status.runtimeProvenance,
      { daemonPath: fs.realpathSync(oldDaemonPath), runtimeRoot: fs.realpathSync(oldRuntimeRoot) },
    );
    const currentRuntimeProvenance = getIndexingRuntimeProvenance(currentDaemonPath, currentRuntimeRoot);
    assert.deepEqual(currentRuntimeProvenance, {
      daemonPath: fs.realpathSync(currentDaemonPath),
      runtimeRoot: fs.realpathSync(currentRuntimeRoot),
    });
    assert.equal(
      canReuseIndexingService({
        configuredDevice: undefined,
        denseEmbeddings: false,
        health: undefined,
        newIndexingVersion: "source-v1",
        newRuntimeConfigFingerprint: "config-v1",
        newRuntimeProvenance: currentRuntimeProvenance,
        status,
      }),
      false,
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
