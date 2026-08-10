import assert from "node:assert/strict";
import { test } from "node:test";
import { canReuseIndexingService } from "./indexing-service-reuse.js";

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
