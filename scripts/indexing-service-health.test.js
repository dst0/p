import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertIndexingServiceRuntime, computeIndexingServiceReadyTimeoutMs } from "./indexing-service-health.js";

test("installed service readiness covers sequential configured backend startup budgets", () => {
  assert.equal(
    computeIndexingServiceReadyTimeoutMs({
      searchMode: "hybrid",
      qdrantStartupTimeoutMs: 120_000,
      embeddingStartupTimeoutMs: 600_000,
    }),
    780_000,
  );
});

test("BM25-only readiness excludes the unused embedding startup budget", () => {
  assert.equal(
    computeIndexingServiceReadyTimeoutMs({
      searchMode: "bm25-only",
      qdrantStartupTimeoutMs: 120_000,
      embeddingStartupTimeoutMs: 600_000,
    }),
    180_000,
  );
});

test("installed service readiness uses safe defaults for absent or invalid budgets", () => {
  assert.equal(computeIndexingServiceReadyTimeoutMs({}), 660_000);
  assert.equal(
    computeIndexingServiceReadyTimeoutMs({
      qdrantStartupTimeoutMs: -1,
      embeddingStartupTimeoutMs: "invalid",
    }),
    660_000,
  );
});

test("installed service must report the exact committed runtime before activation", (context) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "p-service-runtime-")));
  const agentDir = path.join(root, "agent");
  const installed = path.join(root, "installed");
  const oldRuntime = path.join(root, "old-runtime");
  fs.mkdirSync(agentDir);
  fs.mkdirSync(installed);
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const expectedDaemon = path.join(installed, "packages", "coding-agent", "dist", "indexing-service-daemon.js");
  const statusPath = path.join(agentDir, "indexing-service-status.json");
  const writeStatus = (runtimeRoot, daemonPath) => fs.writeFileSync(statusPath, JSON.stringify({
    running: true,
    runtimeProvenance: { runtimeRoot, daemonPath },
  }));

  writeStatus(oldRuntime, path.join(oldRuntime, "packages", "coding-agent", "dist", "indexing-service-daemon.js"));
  assert.throws(() => assertIndexingServiceRuntime(agentDir, installed), /runtime/i);
  writeStatus(installed, path.join(oldRuntime, "packages", "coding-agent", "dist", "indexing-service-daemon.js"));
  assert.throws(() => assertIndexingServiceRuntime(agentDir, installed), /runtime/i);
  writeStatus(installed, expectedDaemon);
  assert.doesNotThrow(() => assertIndexingServiceRuntime(agentDir, installed));
});
