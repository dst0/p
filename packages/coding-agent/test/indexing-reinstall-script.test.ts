import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { INDEXING_SERVICE_REINSTALL_FILE } from "../src/core/indexing-service.ts";
import {
  getIndexingReinstallControlPath,
  isIndexingReinstallMarkerActive,
  stopIndexingDaemonAfterSignal,
  waitForIndexingReinstallMarkerClear,
} from "../src/indexing-service-daemon.ts";

const temporaryDirectories: string[] = [];
const childProcesses: ChildProcess[] = [];
const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const canInspectProcesses =
  spawnSync("ps", ["-p", String(process.pid), "-o", "command="], {
    stdio: "ignore",
  }).status === 0;

afterEach(async () => {
  for (const child of childProcesses.splice(0)) {
    if (child.exitCode === null && child.signalCode === null && child.pid) {
      try {
        process.kill(child.pid, "SIGKILL");
      } catch {
        // The process may have exited between the state check and signal.
      }
    }
    await waitForChildExit(child);
  }
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("indexing reinstall scripts", () => {
  it("clears a stale reuse marker before every new decision and on exit", () => {
    const reinstall = fs.readFileSync(path.join(repositoryRoot, "reinstall.sh"), "utf8");
    const transaction = fs.readFileSync(
      path.join(repositoryRoot, "scripts", "indexing-reinstall-transaction.sh"),
      "utf8",
    );
    const markerClear = "clear_stale_indexing_reuse_decision";
    const flowStart = reinstall.indexOf("INDEXING_REINSTALL_MARKER_ACTIVE=true");
    const decision = reinstall.indexOf("INDEXING_REUSE_DECISION=$(");
    const preDecisionClear = reinstall.indexOf(markerClear, flowStart);
    const markerWrite = reinstall.indexOf("mark_indexing_service_reuse", decision);
    const installer = reinstall.indexOf("node scripts/install-indexing-service.js", decision);
    const lockBegin = reinstall.indexOf("begin_indexing_reinstall_transaction");
    const configMigration = reinstall.indexOf('node "$SCRIPT_DIR/scripts/indexing-config.js" migrate');
    const lockActive = transaction.indexOf("INDEXING_REINSTALL_LOCK_ACTIVE=true", transaction.indexOf("begin_"));
    const lockAcquire = transaction.indexOf('indexing-reinstall-lock.js" --acquire');

    expect(flowStart).toBeGreaterThanOrEqual(0);
    expect(preDecisionClear).toBeGreaterThan(flowStart);
    expect(preDecisionClear).toBeLessThan(decision);
    expect(markerWrite).toBeGreaterThan(decision);
    expect(markerWrite).toBeLessThan(installer);
    expect(lockBegin).toBeGreaterThanOrEqual(0);
    expect(lockBegin).toBeLessThan(configMigration);
    expect(lockActive).toBeGreaterThanOrEqual(0);
    expect(lockActive).toBeLessThan(lockAcquire);
    expect(transaction).toContain('indexing-service-reuse.js" --clear-reuse');
    expect(transaction).toContain('indexing-reinstall-lock.js" --release');
    expect(reinstall).not.toContain('touch "$INDEXING_VERSION_UNCHANGED_FLAG"');
    expect(reinstall).not.toContain('rm -f "$INDEXING_VERSION_UNCHANGED_FLAG"');
    expect(reinstall).toContain('P_INDEXING_REINSTALL_RUN_ID="$INDEXING_REINSTALL_RUN_ID"');
    expect(reinstall).toContain('P_INDEXING_REINSTALL_EXPECTED_REUSE="$INDEXING_REUSE_DECISION"');
  });

  it("documents supported flags and rejects unknown options before reinstalling", () => {
    for (const script of ["install.sh", "reinstall.sh"]) {
      const scriptPath = path.join(repositoryRoot, script);
      const help = spawnSync("bash", [scriptPath, "--help"], { encoding: "utf8" });
      expect(help.status, help.stderr).toBe(0);
      expect(help.stdout).toContain("--select-indexing");

      const unknown = spawnSync("bash", [scriptPath, "--unknown"], { encoding: "utf8" });
      expect(unknown.status).toBe(1);
      expect(unknown.stderr).toContain("Unknown option: --unknown");
    }
  });

  it("routes install-time indexing configuration through the serialized reinstall", () => {
    const install = fs.readFileSync(path.join(repositoryRoot, "install.sh"), "utf8");

    expect(install).not.toContain("prompt_indexing_device_and_batch_size_selection");
    expect(install).not.toContain("prompt_indexing_tray_selection");
    expect(install).toContain('REINSTALL_ARGS+=("--select-indexing")');
    expect(install).toContain(`bash "$SCRIPT_DIR/reinstall.sh" "\${REINSTALL_ARGS[@]}"`);
  });

  it.skipIf(!canInspectProcesses)("force-stops a daemon that ignores the bounded quiesce handshake", async () => {
    const fixture = createFixture();
    const fakeDaemonPath = path.join(fixture.root, "indexing-service-daemon.js");
    const startedPath = path.join(fixture.root, "started");
    fs.writeFileSync(
      fakeDaemonPath,
      [
        'const fs = require("node:fs");',
        'process.on("SIGUSR1", () => {});',
        'process.on("SIGTERM", () => {});',
        "fs.writeFileSync(process.argv[2], String(process.pid));",
        "setInterval(() => {}, 1_000);",
      ].join("\n"),
    );
    const daemon = trackChild(
      spawn(process.execPath, [fakeDaemonPath, startedPath], {
        stdio: "ignore",
      }),
    );
    await waitForFile(startedPath);
    if (!daemon.pid) throw new Error("Fake daemon did not expose a pid");

    fs.mkdirSync(path.dirname(getIndexingReinstallControlPath(fixture.agentDir)), { recursive: true });
    fs.writeFileSync(
      path.join(fixture.agentDir, "indexing-service-status.json"),
      `${JSON.stringify({ pid: daemon.pid, running: true, repos: [] })}\n`,
    );
    fs.writeFileSync(
      getIndexingReinstallControlPath(fixture.agentDir),
      `${JSON.stringify({ pid: daemon.pid, protocolVersion: 1 })}\n`,
    );

    const startedAt = Date.now();
    const result = await runProcess(
      process.execPath,
      [path.join(repositoryRoot, "scripts", "prepare-indexing-service-reinstall.js")],
      {
        ...process.env,
        P_CODING_AGENT_DIR: fixture.agentDir,
        P_INDEXING_REINSTALL_WAIT_MS: "100",
        P_INDEXING_REINSTALL_STOP_WAIT_MS: "100",
      },
    );

    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("did not become quiescent within 100ms");
    expect(`${result.stdout}\n${result.stderr}`).toContain("sending SIGKILL");
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    await waitForChildExit(daemon);
    expect(daemon.signalCode).toBe("SIGKILL");
    expect(fs.existsSync(path.join(fixture.agentDir, INDEXING_SERVICE_REINSTALL_FILE))).toBe(true);
  });

  it("recognizes only fresh, valid reinstall markers", () => {
    const fixture = createFixture();
    const markerPath = path.join(fixture.agentDir, INDEXING_SERVICE_REINSTALL_FILE);
    fs.mkdirSync(fixture.agentDir, { recursive: true });
    const now = Date.now();

    fs.writeFileSync(markerPath, `${JSON.stringify({ pid: 123, startedAt: new Date(now - 1_000).toISOString() })}\n`);
    expect(isIndexingReinstallMarkerActive(fixture.agentDir, now)).toBe(true);

    fs.writeFileSync(markerPath, `${JSON.stringify({ pid: 123, startedAt: new Date(now + 1_000).toISOString() })}\n`);
    expect(isIndexingReinstallMarkerActive(fixture.agentDir, now)).toBe(false);

    fs.writeFileSync(
      markerPath,
      `${JSON.stringify({ pid: 123, startedAt: new Date(now - 5 * 60_000 - 1).toISOString() })}\n`,
    );
    expect(isIndexingReinstallMarkerActive(fixture.agentDir, now)).toBe(false);

    fs.writeFileSync(markerPath, "not-json\n");
    expect(isIndexingReinstallMarkerActive(fixture.agentDir, now)).toBe(false);
  });

  it("does not wait for a stuck quiesce promise when the service is stopped", async () => {
    const neverSettles = new Promise<void>(() => {});
    let graceful: boolean | undefined;
    const daemon = {
      stop: async (options: { graceful?: boolean } = {}) => {
        graceful = options.graceful;
      },
    };

    await stopIndexingDaemonAfterSignal(daemon, neverSettles, false, false);
    expect(graceful).toBe(false);
  });

  it("defers daemon startup until a fresh reinstall marker is cleared", async () => {
    const fixture = createFixture();
    const markerPath = path.join(fixture.agentDir, INDEXING_SERVICE_REINSTALL_FILE);
    fs.mkdirSync(fixture.agentDir, { recursive: true });
    fs.writeFileSync(markerPath, `${JSON.stringify({ pid: 123, startedAt: new Date().toISOString() })}\n`);

    let resolved = false;
    const waiting = waitForIndexingReinstallMarkerClear(fixture.agentDir).then(() => {
      resolved = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(resolved).toBe(false);
    fs.rmSync(markerPath);
    await waiting;
    expect(resolved).toBe(true);
  });
});

function createFixture(): { root: string; agentDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-reinstall-script-"));
  temporaryDirectories.push(root);
  return { root, agentDir: path.join(root, "agent") };
}

function trackChild(child: ChildProcess): ChildProcess {
  childProcesses.push(child);
  return child;
}

async function runProcess(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }> {
  const child = trackChild(
    spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const { code, signal } = await waitForChildExit(child);
  return { code, signal, stdout, stderr };
}

async function waitForChildExit(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode as NodeJS.Signals | null };
  }
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

async function waitForFile(filePath: string, timeoutMs: number = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(filePath)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${filePath}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
