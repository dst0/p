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
const indexingDeviceSelectionScript = path.join(repositoryRoot, "scripts", "indexing-device-selection.sh");
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

  it("loads a valid saved device while preserving an explicit environment override", () => {
    const fixture = createFixture();
    fs.mkdirSync(fixture.agentDir, { recursive: true });
    fs.writeFileSync(path.join(fixture.agentDir, "indexing-device"), "cpu\n");

    const saved = runDeviceSelection(false, false, fixture.agentDir);
    expect(saved.status, saved.stderr).toBe(0);
    expect(saved.stdout).toContain("Loaded saved embedding device: cpu");
    expect(saved.stdout).toContain("device=cpu");

    const overridden = runDeviceSelection(false, false, fixture.agentDir, "mps");
    expect(overridden.status, overridden.stderr).toBe(0);
    expect(overridden.stdout).not.toContain("Loaded saved embedding device");
    expect(overridden.stdout).toContain("device=mps");
  });

  it("forces reselection over an environment value and requires an interactive terminal", () => {
    const fixture = createFixture();
    const forced = runDeviceSelection(true, true, fixture.agentDir, "mps");
    expect(forced.status, forced.stderr).toBe(0);
    expect(forced.stdout).toContain("device=<unset>");

    const nonInteractive = runDeviceSelection(true, false, fixture.agentDir, "mps");
    expect(nonInteractive.status).toBe(1);
    expect(nonInteractive.stderr).toContain("--select-indexing requires an interactive terminal");

    for (const script of ["install.sh", "reinstall.sh"]) {
      const result = spawnSync("bash", [path.join(repositoryRoot, script), "--select-indexing"], {
        encoding: "utf8",
        env: {
          ...process.env,
          P_CODING_AGENT_DIR: fixture.agentDir,
          P_CODE_RAG_DEVICE: "mps",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("--select-indexing requires an interactive terminal");
    }
  });

  it("rejects invalid saved and environment device values", () => {
    const fixture = createFixture();
    fs.mkdirSync(fixture.agentDir, { recursive: true });
    fs.writeFileSync(path.join(fixture.agentDir, "indexing-device"), "invalid\n");

    const saved = runDeviceSelection(false, false, fixture.agentDir);
    expect(saved.status).toBe(1);
    expect(saved.stderr).toContain("Invalid saved embedding device");

    const environment = runDeviceSelection(false, false, fixture.agentDir, "invalid");
    expect(environment.status).toBe(1);
    expect(environment.stderr).toContain("Invalid P_CODE_RAG_DEVICE");
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

  it("keeps global npm relinking quiet without hiding failures", () => {
    const reinstall = fs.readFileSync(path.join(repositoryRoot, "reinstall.sh"), "utf8");
    const linkCommands = reinstall.split("\n").filter((line) => line.includes('"$NPM_BIN" link -w @dst0/p'));

    expect(linkCommands).toHaveLength(2);
    for (const command of linkCommands) {
      expect(command).toContain("--no-audit");
      expect(command).toContain("--no-fund");
      expect(command).toContain("--loglevel=error");
    }
  });

  it("initializes max embed batch size from environment or saved file and validates values", () => {
    const fixture = createFixture();
    fs.mkdirSync(fixture.agentDir, { recursive: true });

    const envRes = runBatchSizeSelection(false, false, fixture.agentDir, "16");
    expect(envRes.status).toBe(0);
    expect(envRes.stdout).toContain("batch_size=16");

    const batchFile = path.join(fixture.agentDir, "indexing-max-batch-size");
    fs.writeFileSync(batchFile, "32\n", "utf8");
    const savedRes = runBatchSizeSelection(false, false, fixture.agentDir);
    expect(savedRes.status).toBe(0);
    expect(savedRes.stdout).toContain("batch_size=32");

    fs.writeFileSync(batchFile, "invalid\n", "utf8");
    const invalidRes = runBatchSizeSelection(false, false, fixture.agentDir);
    expect(invalidRes.status).toBe(1);
    expect(invalidRes.stderr).toContain("Invalid saved embedding batch size");
  });
});

function runBatchSizeSelection(
  forceSelection: boolean,
  interactive: boolean,
  agentDir: string,
  batchSize?: string,
): ReturnType<typeof spawnSync> & { stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, P_CODING_AGENT_DIR: agentDir };
  if (batchSize === undefined) delete env.P_CODE_RAG_MAX_EMBED_BATCH_SIZE;
  else env.P_CODE_RAG_MAX_EMBED_BATCH_SIZE = batchSize;
  const result = spawnSync(
    "bash",
    [
      "-c",
      'set -e; source "$1"; AGENT_DIR="$P_CODING_AGENT_DIR"; INDEXING_BATCH_SIZE_FILE="$AGENT_DIR/indexing-max-batch-size"; initialize_indexing_batch_size_selection "$2" "$3"; if declare -p P_CODE_RAG_MAX_EMBED_BATCH_SIZE >/dev/null 2>&1; then printf "batch_size=%s\\n" "$P_CODE_RAG_MAX_EMBED_BATCH_SIZE"; else echo "batch_size=<unset>"; fi',
      "bash",
      indexingDeviceSelectionScript,
      String(forceSelection),
      String(interactive),
    ],
    { encoding: "utf8", env },
  );
  return result as ReturnType<typeof spawnSync> & { stdout: string; stderr: string };
}

function runDeviceSelection(
  forceSelection: boolean,
  interactive: boolean,
  agentDir: string,
  device?: string,
): ReturnType<typeof spawnSync> & { stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, P_CODING_AGENT_DIR: agentDir };
  if (device === undefined) delete env.P_CODE_RAG_DEVICE;
  else env.P_CODE_RAG_DEVICE = device;
  const result = spawnSync(
    "bash",
    [
      "-c",
      'set -e; source "$1"; AGENT_DIR="$P_CODING_AGENT_DIR"; INDEXING_DEVICE_FILE="$AGENT_DIR/indexing-device"; initialize_indexing_device_selection "$2" "$3"; if declare -p P_CODE_RAG_DEVICE >/dev/null 2>&1; then printf "device=%s\\n" "$P_CODE_RAG_DEVICE"; else echo "device=<unset>"; fi',
      "bash",
      indexingDeviceSelectionScript,
      String(forceSelection),
      String(interactive),
    ],
    { encoding: "utf8", env },
  );
  return result as ReturnType<typeof spawnSync> & { stdout: string; stderr: string };
}

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
