import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  acquireIndexingReinstallLock,
  assertIndexingReinstallLockOwner,
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

test("a child may share only its live parent's exact reinstall lock", () => {
  const agentDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-inherited-lock-"));
  const transaction = path.join(import.meta.dirname, "indexing-reinstall-transaction.sh");
  const child = (id, pid) => spawnSync(
    "bash",
    ["-c", 'set -e; source "$1"; begin_indexing_reinstall_transaction "$2"; printf "%s:%s\\n" "$INDEXING_REINSTALL_RUN_ID" "$INDEXING_REINSTALL_LOCK_ACTIVE"', "bash", transaction, agentDirectory],
    {
      encoding: "utf8",
      env: { ...process.env, P_INDEXING_REINSTALL_PARENT_RUN_ID: id, P_INDEXING_REINSTALL_PARENT_PID: String(pid) },
    },
  );
  try {
    acquireIndexingReinstallLock(agentDirectory, runId, process.pid);
    assert.equal(assertIndexingReinstallLockOwner(agentDirectory, runId, process.pid), true);
    const permitted = child(runId, process.pid);
    assert.equal(permitted.status, 0, permitted.stderr);
    assert.equal(permitted.stdout.trim(), `${runId}:false`);
    assert.equal(fs.existsSync(path.join(agentDirectory, "indexing-reinstall.lock")), true);
    assert.notEqual(child("wrong-run", process.pid).status, 0);
    assert.notEqual(child(runId, process.pid + 1).status, 0);
    assert.equal(releaseIndexingReinstallLock(agentDirectory, runId), true);
    assert.notEqual(child(runId, process.pid).status, 0);
  } finally {
    releaseIndexingReinstallLock(agentDirectory, runId);
    fs.rmSync(agentDirectory, { recursive: true, force: true });
  }
});

test("a relative agent directory keeps the same lock across staged runtime cwd changes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-relative-indexing-lock-"));
  const source = path.join(root, "source");
  const candidate = path.join(root, "candidate");
  const transaction = path.join(import.meta.dirname, "indexing-reinstall-transaction.sh");
  fs.mkdirSync(source);
  fs.mkdirSync(candidate);
  try {
    const result = spawnSync("bash", ["-c", [
      "set -euo pipefail",
      'cd "$2"',
      'source "$1"',
      'begin_indexing_reinstall_transaction "$P_CODING_AGENT_DIR"',
      "trap cleanup_indexing_reinstall_transaction EXIT",
      'export P_INDEXING_REINSTALL_PARENT_RUN_ID="$INDEXING_REINSTALL_RUN_ID"',
      'export P_INDEXING_REINSTALL_PARENT_PID="$$"',
      "bash -c 'set -euo pipefail; cd \"$1\"; source \"$2\"; begin_indexing_reinstall_transaction \"$P_CODING_AGENT_DIR\"; printf \"%s\\n\" \"$INDEXING_REINSTALL_AGENT_DIR\"' bash \"$3\" \"$1\"",
    ].join("\n"), "bash", transaction, source, candidate], {
      encoding: "utf8",
      env: { ...process.env, P_CODING_AGENT_DIR: "relative-agent" },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), path.join(fs.realpathSync(source), "relative-agent"));
    assert.equal(fs.existsSync(path.join(source, "relative-agent", "indexing-reinstall.lock")), false);
    assert.equal(fs.existsSync(path.join(candidate, "relative-agent", "indexing-reinstall.lock")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
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
