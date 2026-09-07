import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { brotliDecompressSync } from "node:zlib";
import { runBenchmarkAgentTurn } from "../../src/agents/turn.ts";
import { createBenchmarkRecording } from "../../src/harness/recording-lifecycle.ts";
import { runAgentTask } from "../../src/workloads/agent-turn-runner.ts";
import type { RunnerOptions } from "../../src/workloads/runner-options.ts";
import type { BenchmarkTask } from "../../src/workloads/task-definition.ts";

const metricEventTypes = new Set(["result"]);

function command(source: string) {
  return {
    executable: process.execPath,
    args: ["-e", source],
    cwd: process.cwd(),
    env: process.env,
  };
}

test("P enforces one global metric-event budget across subprocess turns", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-global-metric-budget-"));
  const workspace = join(root, "workspace");
  const config = join(root, "config");
  const recordingPath = join(root, "recordings", "p.jsonl.br");
  const fakeCli = join(root, "fake-p.js");
  mkdirSync(workspace);
  mkdirSync(config);
  mkdirSync(join(root, "recordings"));
  writeFileSync(fakeCli, multiTurnPSource());

  try {
    const result = await runAgentTask(
      "p",
      runnerOptions(fakeCli),
      task,
      config,
      workspace,
      recordingPath,
      30,
      performance.now() + 60_000,
    );

    assert.equal(Number(readFileSync(join(workspace, "invocations.txt"), "utf8")), 2);
    assert.equal(result.nudges, 1);
    assert.equal(result.signal, "SIGTERM");
    assert.equal(result.error, "metric events exceeded 1 entries");
    assert.deepEqual(result.captureOverflow, {
      kind: "capture_overflow",
      captureName: "metric events",
      limitCount: 1,
      observedCountAtLeast: 2,
      turn: 2,
    });
    assert.equal(result.rawEventCount, 4);
    assert.equal(result.metrics?.eventCount, 3);
    assert.deepEqual(result.metrics?.eventTypes, { result: 3 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a metric observer failure terminates the child and preserves exact raw evidence", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-metric-observer-failure-"));
  const finalPath = join(root, "turn.jsonl.br");
  const recording = createBenchmarkRecording(finalPath);
  const rawLine = `${JSON.stringify({ type: "result", value: "record-before-observer-failure" })}\n`;
  const observerError = new Error("metric observer failed exactly");

  try {
    const result = await runBenchmarkAgentTurn(
      command(`process.stdout.write(${JSON.stringify(rawLine)}); setInterval(() => {}, 1000);`),
      10_000,
      recording,
      metricEventTypes,
      {
        failureKillGraceMs: 50,
        onMetricEvent: () => {
          throw observerError;
        },
        retainMetricOutput: false,
      },
    );

    assert.equal(result.error, observerError.message);
    assert.equal(result.signal, "SIGTERM");
    assert.equal(result.captureOverflow, undefined);
    assert.equal(result.metricEventCount, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.elapsedMs < 2_000);
    await recording.finalize();
    assert.equal(brotliDecompressSync(readFileSync(finalPath)).toString("utf8"), rawLine);
  } finally {
    await recording.abort();
    rmSync(root, { recursive: true, force: true });
  }
});

const task: BenchmarkTask = {
  id: "global-metric-budget",
  timeoutSeconds: 30,
  maxScore: 1,
  description: "Exercise the metric-event budget across P turns",
  files: {},
  prompt: "Complete the fixture.",
  verify: () => ({ passed: true, score: 1, maxScore: 1, checks: [] }),
};

function runnerOptions(pCli: string): RunnerOptions {
  return {
    model: "provider/model",
    pCli,
    projectInstructionProbe: "/unused/probe.js",
    projectInstructionsFile: "/unused/AGENTS.md",
    taskVerificationMode: "off",
    agents: ["p"],
    modelsFile: "/unused/models.json",
    piVersion: "unused",
    kiloVersion: "unused",
    kiloConfig: "/unused/kilo.jsonc",
    kiloStartupTimeoutSeconds: 1,
    codexConfig: "/unused/codex.toml",
    runs: 1,
    timeoutSeconds: 30,
    maxRuntimeSeconds: 60,
    outputLimits: { maxMetricEvents: 3 },
  };
}

function multiTurnPSource(): string {
  return `
const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const continued = process.argv.includes("--continue");
const count = existsSync("invocations.txt") ? Number(readFileSync("invocations.txt", "utf8")) : 0;
writeFileSync("invocations.txt", String(count + 1));
const emit = (value) => process.stdout.write(JSON.stringify({ type: "result", value }) + "\\n");
emit(continued ? "turn-2-within-global-cap" : "turn-1-event-1");
emit(continued ? "turn-2-first-excess" : "turn-1-event-2");
if (continued) setInterval(() => {}, 1000);
`;
}
