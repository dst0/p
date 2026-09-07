import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const childProcesses: ChildProcess[] = [];
const closedChildren = new WeakSet<ChildProcess>();
const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const transactionScript = path.join(repositoryRoot, "scripts", "indexing-reinstall-transaction.sh");
const indexingVersion = "a".repeat(64);
const runtimeFingerprint = "b".repeat(64);

afterEach(async () => {
  const cleanup = await Promise.allSettled(
    childProcesses.splice(0).map(async (child) => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await waitForChildExit(child, 5_000);
    }),
  );
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
  const failures = cleanup.filter((result) => result.status === "rejected").map((result) => result.reason);
  if (failures.length > 0) throw new AggregateError(failures, "Transaction child cleanup failed");
});

describe("indexing reinstall transaction", () => {
  it("keeps the owner's reuse decision when a concurrent transaction fails to acquire the lock", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-transaction-"));
    temporaryDirectories.push(root);
    const agentDirectory = path.join(root, "agent");
    const readyPath = path.join(root, "ready");
    const stopPath = path.join(root, "stop");
    const holder = trackChild(
      spawn(
        "bash",
        [
          "-c",
          holderScript,
          "holder",
          transactionScript,
          agentDirectory,
          readyPath,
          stopPath,
          indexingVersion,
          runtimeFingerprint,
        ],
        { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] },
      ),
    );
    await waitForFile(readyPath, holder);

    const contender = spawnSync("bash", ["-c", contenderScript, "contender", transactionScript, agentDirectory], {
      cwd: repositoryRoot,
      encoding: "utf8",
      killSignal: "SIGKILL",
      timeout: 30_000,
    });
    expect(contender.status).not.toBe(0);
    expect(contender.stderr).toContain("already running");
    const decisionPath = path.join(agentDirectory, "indexing-version-unchanged");
    const decision = JSON.parse(fs.readFileSync(decisionPath, "utf8"));
    expect(decision.indexingVersion).toBe(indexingVersion);
    expect(decision.runtimeConfigFingerprint).toBe(runtimeFingerprint);
    expect(fs.existsSync(path.join(agentDirectory, "indexing-reinstall.lock"))).toBe(true);

    fs.writeFileSync(stopPath, "stop\n");
    const completed = await waitForChildExit(holder);
    expect(completed.code).toBe(0);
    expect(fs.existsSync(decisionPath)).toBe(false);
    expect(fs.existsSync(path.join(agentDirectory, "indexing-reinstall.lock"))).toBe(false);
  });
});

const holderScript = `
set -euo pipefail
source "$1"
trap cleanup_indexing_reinstall_transaction EXIT
begin_indexing_reinstall_transaction "$2"
mark_indexing_service_reuse "$5" "$6"
printf ready > "$3"
while [[ ! -f "$4" ]]; do sleep 0.05; done
`;

const contenderScript = `
set -euo pipefail
source "$1"
trap cleanup_indexing_reinstall_transaction EXIT
begin_indexing_reinstall_transaction "$2"
`;

function trackChild(child: ChildProcess): ChildProcess {
  childProcesses.push(child);
  child.once("close", () => closedChildren.add(child));
  return child;
}

async function waitForFile(filePath: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (!fs.existsSync(filePath)) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("Transaction holder exited early");
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${filePath}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function waitForChildExit(
  child: ChildProcess,
  timeoutMs: number = 30_000,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (closedChildren.has(child)) {
    return { code: child.exitCode, signal: child.signalCode as NodeJS.Signals | null };
  }
  return new Promise((resolve, reject) => {
    let failure: Error | undefined;
    let killGrace: ReturnType<typeof setTimeout> | undefined;
    const timeout = setTimeout(() => {
      failure = new Error(`Timed out waiting ${timeoutMs}ms for transaction child ${child.pid ?? "unknown"}`);
      child.kill("SIGKILL");
      killGrace = setTimeout(() => reject(new Error("Transaction child did not close after SIGKILL")), 5_000);
    }, timeoutMs);
    child.once("error", (error) => {
      failure = error;
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (killGrace) clearTimeout(killGrace);
      if (failure) reject(failure);
      else resolve({ code, signal });
    });
  });
}
