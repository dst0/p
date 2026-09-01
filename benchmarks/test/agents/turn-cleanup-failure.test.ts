import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { runBenchmarkAgentTurn } from "../../src/agents/turn.ts";
import { createBenchmarkRecording } from "../../src/harness/recording-lifecycle.ts";

const metricEventTypes = new Set(["result"]);

function command(source: string) {
  return { executable: process.execPath, args: ["-e", source], cwd: process.cwd(), env: process.env };
}

function killProcess(pid: number | undefined, processGroup = false): unknown {
  if (!pid) return undefined;
  try {
    process.kill(processGroup ? -pid : pid, "SIGKILL");
    return undefined;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH" ? undefined : error;
  }
}

function settledError(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

test("failed cleanup rejects after the direct child exits", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-turn-cleanup-exit-"));
  const recording = createBenchmarkRecording(join(root, "turn.jsonl.br"));
  try {
    await assert.rejects(
      runBenchmarkAgentTurn(command("setInterval(() => {}, 1000);"), 100, recording, metricEventTypes, {
        terminateProcessTree: async (child) => {
          child.kill("SIGTERM");
          return false;
        },
        timeoutMode: "semantic_progress",
      }),
      /process tree did not terminate/u,
    );
  } finally {
    await recording.abort();
    rmSync(root, { recursive: true, force: true });
  }
});

test("failed cleanup rejects despite a descendant retaining inherited pipes", { timeout: 5_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-turn-orphan-cleanup-"));
  const descendantPidPath = join(root, "descendant.pid");
  const recording = createBenchmarkRecording(join(root, "turn.jsonl.br"));
  const descendantSource = 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);';
  const source = `
    const { spawn } = require("node:child_process");
    const { writeFileSync } = require("node:fs");
    const descendant = spawn(process.execPath, ["-e", ${JSON.stringify(descendantSource)}], {
      detached: true,
      stdio: ["ignore", "inherit", "inherit"],
    });
    writeFileSync(${JSON.stringify(descendantPidPath)}, String(descendant.pid));
    setInterval(() => {}, 1000);
  `;
  const turnPromise = runBenchmarkAgentTurn(command(source), 200, recording, metricEventTypes, {
    terminateProcessTree: async (child) => {
      child.kill("SIGTERM");
      return false;
    },
    timeoutMode: "semantic_progress",
  });
  const settlement = settledError(turnPromise);
  let cleanupError: unknown;
  let outcome: unknown;
  try {
    outcome = await Promise.race([settlement, new Promise((resolve) => setTimeout(resolve, 1_000, "hung"))]);
  } finally {
    const descendantPid = existsSync(descendantPidPath) ? Number(readFileSync(descendantPidPath, "utf8")) : undefined;
    cleanupError = killProcess(descendantPid, true);
    await settlement;
    await recording.abort();
    rmSync(root, { recursive: true, force: true });
  }
  if (cleanupError) throw cleanupError;
  assert.notEqual(outcome, "hung");
  assert.match(String(outcome), /process tree did not terminate/u);
});

test("failed cleanup rejects while the direct child remains alive", { timeout: 5_000 }, async () => {
  for (const cleanupFailure of ["false", "rejection"] as const) {
    const root = mkdtempSync(join(tmpdir(), `p-benchmark-turn-live-child-${cleanupFailure}-`));
    const recording = createBenchmarkRecording(join(root, "turn.jsonl.br"));
    let childPid: number | undefined;
    const turnPromise = runBenchmarkAgentTurn(
      command("setInterval(() => {}, 1000);"),
      100,
      recording,
      metricEventTypes,
      {
        terminateProcessTree: async (child) => {
          childPid = child.pid;
          if (cleanupFailure === "rejection") throw new Error("simulated cleanup rejection");
          return false;
        },
        timeoutMode: "semantic_progress",
      },
    );
    const settlement = settledError(turnPromise);
    let cleanupError: unknown;
    let outcome: unknown;
    try {
      outcome = await Promise.race([settlement, new Promise((resolve) => setTimeout(resolve, 1_000, "hung"))]);
    } finally {
      cleanupError = killProcess(childPid);
      await settlement;
      await recording.abort();
      rmSync(root, { recursive: true, force: true });
    }
    if (cleanupError) throw cleanupError;
    assert.notEqual(outcome, "hung");
    assert.match(
      String(outcome),
      cleanupFailure === "rejection" ? /simulated cleanup rejection/u : /process tree did not terminate/u,
    );
  }
});

test("a failed-cleanup helper exits before its surviving agent is test-cleaned", { timeout: 5_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-cleanup-helper-"));
  const agentPidPath = join(root, "agent.pid");
  const outcomePath = join(root, "outcome.txt");
  const turnModule = pathToFileURL(join(process.cwd(), "benchmarks", "src", "agents", "turn.ts")).href;
  const agentSource = `
    const { writeFileSync } = require("node:fs");
    writeFileSync(${JSON.stringify(agentPidPath)}, String(process.pid));
    setInterval(() => {}, 1000);
  `;
  const helperSource = `
    import { writeFileSync } from "node:fs";
    import { Writable } from "node:stream";
    import { runBenchmarkAgentTurn } from ${JSON.stringify(turnModule)};
    const recording = {
      stream: new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
      capture: {},
      onFailure() { return () => {}; },
    };
    try {
      await runBenchmarkAgentTurn(
        { executable: process.execPath, args: ["-e", ${JSON.stringify(agentSource)}], cwd: process.cwd(), env: process.env },
        100,
        recording,
        new Set(),
        { projectInstructionProofReceipt: "a".repeat(64), terminateProcessTree: async () => false },
      );
      writeFileSync(${JSON.stringify(outcomePath)}, "verification-ran");
    } catch (error) {
      writeFileSync(${JSON.stringify(outcomePath)}, "fatal:" + error.message);
    }
  `;
  const helper = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", helperSource], {
    cwd: process.cwd(),
    stdio: "ignore",
  });
  let cleanupError: unknown;
  let exitCode: number | null | "hung" = "hung";
  let outcome = "";
  try {
    exitCode = await Promise.race([
      new Promise<number | null>((resolve) => helper.once("close", resolve)),
      new Promise<"hung">((resolve) => setTimeout(resolve, 1_500, "hung")),
    ]);
  } finally {
    if (exitCode === "hung") helper.kill("SIGKILL");
    const agentPid = existsSync(agentPidPath) ? Number(readFileSync(agentPidPath, "utf8")) : undefined;
    cleanupError = killProcess(agentPid, true);
    if (existsSync(outcomePath)) outcome = readFileSync(outcomePath, "utf8");
    rmSync(root, { recursive: true, force: true });
  }
  if (cleanupError) throw cleanupError;
  assert.equal(exitCode, 0);
  assert.match(outcome, /^fatal:benchmark process tree did not terminate$/u);
});
