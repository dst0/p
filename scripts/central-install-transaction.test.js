import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { acquireIndexingReinstallLock, releaseIndexingReinstallLock } from "./indexing-reinstall-lock.js";

const transaction = path.join(import.meta.dirname, "central-install-transaction.sh");
const indexingTransaction = path.join(import.meta.dirname, "indexing-reinstall-transaction.sh");

function setup(context, candidateExit, priorExit) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-central-transaction-"));
  const candidate = path.join(root, "candidate");
  const prior = path.join(root, "prior");
  const events = path.join(root, "events");
  fs.mkdirSync(candidate);
  fs.mkdirSync(prior);
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [directory, label, code] of [[candidate, "candidate", candidateExit], [prior, "prior", priorExit]]) {
    fs.writeFileSync(
      path.join(directory, "reinstall.sh"),
      `#!/bin/bash\nprintf '${label}\\n' >> "$P_INSTALL_TEST_EVENTS"\nexit ${code}\n`,
      { mode: 0o700 },
    );
  }
  return { root, candidate, prior, events };
}

function run(state, previous) {
  return spawnSync("bash", ["-c", 'source "$1"; run_centralized_install_candidate "$2" "$3"', "bash", transaction, state.candidate, previous], {
    encoding: "utf8",
    env: { ...process.env, P_INSTALL_TEST_EVENTS: state.events },
  });
}

test("failed candidate reinstalls the previous built runtime but keeps the original failure", (context) => {
  const state = setup(context, 37, 0);
  const result = run(state, state.prior);
  assert.equal(result.status, 37, result.stderr);
  assert.equal(fs.readFileSync(state.events, "utf8"), "candidate\nprior\n");
  assert.match(result.stderr, /restored/i);
});

test("successful candidate does not reinstall the previous runtime", (context) => {
  const state = setup(context, 0, 0);
  const result = run(state, state.prior);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(state.events, "utf8"), "candidate\n");
});

test("first-install failure has no previous runtime to restore", (context) => {
  const state = setup(context, 29, 0);
  const result = run(state, "");
  assert.equal(result.status, 29, result.stderr);
  assert.equal(fs.readFileSync(state.events, "utf8"), "candidate\n");
  assert.match(result.stderr, /no previous/i);
});

test("a failed restoration reports both failures without hiding the candidate error", (context) => {
  const state = setup(context, 37, 23);
  const result = run(state, state.prior);
  assert.equal(result.status, 37);
  assert.equal(fs.readFileSync(state.events, "utf8"), "candidate\nprior\n");
  assert.match(result.stderr, /failed to restore/i);
});

test("one home install lock excludes different agent directories and verifies inherited ownership", (context) => {
  const state = setup(context, 0, 0);
  const installRoot = path.join(state.root, "install");
  fs.mkdirSync(installRoot);
  const runId = "central-install-parent";
  const child = (agentDir, parentRunId, parentPid) => spawnSync(
    "bash",
    ["-c", 'set -e; source "$1"; begin_central_install_transaction "$2"; printf "%s:%s\\n" "$CENTRAL_INSTALL_LOCK_RUN_ID" "$CENTRAL_INSTALL_LOCK_ACTIVE"', "bash", transaction, installRoot],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        P_CODING_AGENT_DIR: agentDir,
        P_CENTRAL_INSTALL_PARENT_RUN_ID: parentRunId,
        P_CENTRAL_INSTALL_PARENT_PID: String(parentPid),
      },
    },
  );
  try {
    acquireIndexingReinstallLock(installRoot, runId, process.pid);
    const inherited = child(path.join(state.root, "agent-a"), runId, process.pid);
    assert.equal(inherited.status, 0, inherited.stderr);
    assert.equal(inherited.stdout.trim(), `${runId}:false`);
    assert.notEqual(child(path.join(state.root, "agent-b"), "", 0).status, 0);
    assert.notEqual(child(path.join(state.root, "agent-b"), "wrong-run", process.pid).status, 0);
  } finally {
    releaseIndexingReinstallLock(installRoot, runId);
  }
});

test("parent releases the home lock after a candidate failure and reports a failed release", (context) => {
  const state = setup(context, 17, 0);
  const installRoot = path.join(state.root, "install");
  fs.mkdirSync(installRoot);
  const run = (removeBeforeCleanup) => spawnSync(
    "bash",
    [
      "-c",
      'set -e; source "$1"; begin_central_install_transaction "$2"; run_centralized_install_candidate "$3" "$4" || true; if [[ "$5" == yes ]]; then rm "$2/indexing-reinstall.lock"; fi; cleanup_central_install_transaction',
      "bash", transaction, installRoot, state.candidate, state.prior, removeBeforeCleanup ? "yes" : "no",
    ],
    { encoding: "utf8", env: { ...process.env, P_INSTALL_TEST_EVENTS: state.events } },
  );
  const released = run(false);
  assert.equal(released.status, 0, released.stderr);
  assert.equal(fs.existsSync(path.join(installRoot, "indexing-reinstall.lock")), false);
  const failedRelease = run(true);
  assert.notEqual(failedRelease.status, 0);
});

test("EXIT trap retains failures and releases both locks even when one release fails", (context) => {
  const state = setup(context, 0, 0);
  const installRoot = path.join(state.root, "install");
  const agentDir = path.join(state.root, "agent");
  fs.mkdirSync(installRoot);
  const env = { ...process.env };
  delete env.P_CENTRAL_INSTALL_PARENT_RUN_ID;
  delete env.P_CENTRAL_INSTALL_PARENT_PID;
  delete env.P_INDEXING_REINSTALL_PARENT_RUN_ID;
  delete env.P_INDEXING_REINSTALL_PARENT_PID;
  const runExit = (status, breakLock) => spawnSync(
    "bash",
    [
      "-c",
      'set -euo pipefail; source "$1"; source "$2"; INDEXING_REINSTALL_MARKER_ACTIVE=false; trap finish_reinstall_transaction EXIT; begin_central_install_transaction "$3"; begin_indexing_reinstall_transaction "$4"; if [[ "$5" == agent ]]; then rm "$4/indexing-reinstall.lock"; elif [[ "$5" == home ]]; then rm "$3/indexing-reinstall.lock"; fi; exit "$6"',
      "bash", transaction, indexingTransaction, installRoot, agentDir, breakLock, String(status),
    ],
    { encoding: "utf8", env },
  );

  const originalFailure = runExit(37, "none");
  assert.equal(originalFailure.status, 37, originalFailure.stderr);
  assert.equal(fs.existsSync(path.join(agentDir, "indexing-reinstall.lock")), false);
  assert.equal(fs.existsSync(path.join(installRoot, "indexing-reinstall.lock")), false);

  const failedAgentRelease = runExit(0, "agent");
  assert.equal(failedAgentRelease.status, 1);
  assert.match(failedAgentRelease.stderr, /Failed to release the indexing reinstall lock/);
  assert.equal(fs.existsSync(path.join(installRoot, "indexing-reinstall.lock")), false);

  const failedHomeRelease = runExit(0, "home");
  assert.equal(failedHomeRelease.status, 1);
  assert.match(failedHomeRelease.stderr, /Failed to release the central install lock/);
  assert.equal(fs.existsSync(path.join(agentDir, "indexing-reinstall.lock")), false);
});
