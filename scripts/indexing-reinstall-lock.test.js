import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  acquireIndexingReinstallLock,
  releaseIndexingReinstallLock,
} from "./indexing-reinstall-lock.js";

const runId = "reinstall-run-a";

test("serializes indexing reinstalls with an owner-bound private lock", () => {
  const agentDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-lock-"));
  const lockPath = path.join(agentDirectory, "indexing-reinstall.lock");
  try {
    acquireIndexingReinstallLock(agentDirectory, runId, process.pid);
    assert.equal(fs.statSync(lockPath).mode & 0o777, 0o600);
    assert.throws(
      () => acquireIndexingReinstallLock(agentDirectory, "reinstall-run-b", process.pid),
      /already running/,
    );
    assert.equal(releaseIndexingReinstallLock(agentDirectory, "reinstall-run-b"), false);
    assert.equal(fs.existsSync(lockPath), true);
    assert.equal(releaseIndexingReinstallLock(agentDirectory, runId), true);
    assert.equal(fs.existsSync(lockPath), false);
  } finally {
    fs.rmSync(agentDirectory, { recursive: true, force: true });
  }
});

test("a dead lock owner fails closed with an exact manual recovery target", async () => {
  const agentDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-lock-"));
  const lockPath = path.join(agentDirectory, "indexing-reinstall.lock");
  const owner = spawn(process.execPath, ["-e", "setInterval(() => {}, 1_000)"], { stdio: "ignore" });
  const ownerClosed = new Promise((resolve) => owner.once("close", resolve));
  try {
    if (!owner.pid) throw new Error("Lock owner did not expose a pid");
    acquireIndexingReinstallLock(agentDirectory, runId, owner.pid);
    owner.kill("SIGKILL");
    await waitForChildClose(ownerClosed);

    assert.throws(
      () => acquireIndexingReinstallLock(agentDirectory, "reinstall-run-b", process.pid),
      (error) => error instanceof Error && error.message.includes(`stale for run ${runId} at ${lockPath}`),
    );
    assert.equal(fs.existsSync(lockPath), true);
    assert.equal(releaseIndexingReinstallLock(agentDirectory, runId), true);
  } finally {
    if (owner.exitCode === null && owner.signalCode === null) owner.kill("SIGKILL");
    try {
      await waitForChildClose(ownerClosed);
    } finally {
      fs.rmSync(agentDirectory, { recursive: true, force: true });
    }
  }
});

async function waitForChildClose(closePromise, timeoutMs = 30_000) {
  let timeout;
  try {
    await Promise.race([
      closePromise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Lock owner did not close after SIGKILL")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
