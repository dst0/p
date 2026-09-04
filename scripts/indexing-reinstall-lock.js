#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REINSTALL_LOCK_FILE = "indexing-reinstall.lock";

export function acquireIndexingReinstallLock(agentDir, runId, ownerPid = process.pid) {
  validateRunId(runId);
  if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) throw new Error("Invalid indexing reinstall owner pid");
  if (!isProcessRunning(ownerPid)) throw new Error(`Indexing reinstall owner pid ${ownerPid} is not running`);
  fs.mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  const lockPath = path.join(agentDir, REINSTALL_LOCK_FILE);
  const temporaryPath = `${lockPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(
      temporaryPath,
      `${JSON.stringify({ formatVersion: 1, ownerPid, runId })}\n`,
      { flag: "wx", mode: 0o600 },
    );
    try {
      fs.linkSync(temporaryPath, lockPath);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      const owner = readLockOwner(lockPath);
      if (owner && isProcessRunning(owner.ownerPid)) {
        throw new Error(`Indexing reinstall is already running with pid ${owner.ownerPid}`);
      }
      const suffix = owner ? ` for run ${owner.runId}` : "";
      throw new Error(
        `Indexing reinstall lock is stale${suffix} at ${lockPath}; verify its owner is gone and remove that exact file`,
      );
    }
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

export function releaseIndexingReinstallLock(agentDir, runId) {
  validateRunId(runId);
  const lockPath = path.join(agentDir, REINSTALL_LOCK_FILE);
  const owner = readLockOwner(lockPath);
  if (!owner || owner.runId !== runId) return false;
  try {
    fs.unlinkSync(lockPath);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

function readLockOwner(lockPath) {
  try {
    const stat = fs.lstatSync(lockPath);
    if (!stat.isFile() || stat.isSymbolicLink()) return undefined;
    const owner = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    if (
      !owner ||
      owner.formatVersion !== 1 ||
      !Number.isSafeInteger(owner.ownerPid) ||
      owner.ownerPid <= 0 ||
      typeof owner.runId !== "string"
    ) {
      return undefined;
    }
    validateRunId(owner.runId);
    return owner;
  } catch {
    return undefined;
  }
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

function validateRunId(runId) {
  if (typeof runId !== "string" || runId.length === 0 || runId.length > 200) {
    throw new Error("Invalid indexing reinstall run id");
  }
}

async function runCli() {
  const [command, agentDir, runId, ownerPid] = process.argv.slice(2);
  if (command === "--acquire") {
    acquireIndexingReinstallLock(agentDir, runId, Number(ownerPid));
    return;
  }
  if (command === "--release") {
    if (!releaseIndexingReinstallLock(agentDir, runId)) process.exitCode = 1;
    return;
  }
  throw new Error("Expected --acquire or --release");
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  await runCli();
}
