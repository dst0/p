import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { brotliDecompressSync } from "node:zlib";

import {
  BenchmarkInterruptedError,
} from "./benchmark-interruption.js";
import { runProjectInstructionsBenchmark } from "./benchmark-project-instructions.js";
import { runPairedBenchmarkSchedule } from "./benchmark-project-instructions-schedule.js";
import {
  createCellLivenessMonitor,
  runBenchmarkChild,
} from "./benchmark-project-instructions-liveness.js";

const pair = { run: 1, task: "event-sourced-inventory", modes: ["legacy", "compiled"] };

function passedSample(mode) {
  return {
    run: 1,
    task: pair.task,
    mode,
    status: "passed",
    elapsedMs: 1,
    metrics: { usage: { totalTokens: 1 } },
    quality: { passed: true, rawScore: 1, maxScore: 1, checks: [{ passed: true }] },
    liveness: { semanticEvidenceAvailable: true, semanticEvidenceComplete: true },
  };
}

function scheduleDocument() {
  return {
    candidateVersion: "5.0.1-rc.1",
    generatedAt: "2026-08-24T00:00:00.000Z",
    model: "provider/model",
    binarySha256: "a".repeat(64),
    seed: "seed",
    runs: 3,
    tasks: [pair.task],
    schedule: [pair],
    samples: [],
    runStatus: "running",
    completed: false,
    gate: { passed: false },
  };
}

test("initial paired evidence keeps correctness pending instead of passed", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-paired-pending-state-"));
  const runtimeSnapshot = join(root, "runtime");
  const scratchRoot = join(root, "scratch");
  const privateRoot = join(root, "private");
  const output = join(root, "run-v5.0.1-rc.1-pending-state");
  mkdirSync(join(root, "packages", "coding-agent", "dist"), { recursive: true });
  mkdirSync(runtimeSnapshot);
  mkdirSync(scratchRoot);
  mkdirSync(privateRoot);
  writeFileSync(join(root, "AGENTS.md"), "rules\n");
  writeFileSync(join(root, "packages", "coding-agent", "dist", "cli.js"), "runtime\n");
  const authPath = join(privateRoot, "auth.json");
  const modelsPath = join(privateRoot, "models.json");
  writeFileSync(authPath, "{}\n");
  writeFileSync(modelsPath, "{}\n");
  let scheduled;
  try {
    await runProjectInstructionsBenchmark({
      argv: ["--model", "provider/model", "--output", output],
      environment: { P_BENCHMARK_CANDIDATE_VERSION: "5.0.1-rc.1" },
      root,
      dependencies: {
        createResources: () => ({
          runtimeSnapshot,
          scratchRoot,
          privateSnapshots: { auth: { path: authPath }, models: { path: modelsPath } },
        }),
        createAuthOutputGuard: () => undefined,
        privateInputEvidence: () => ({}),
        hashRuntime: () => "a".repeat(64),
        registerCandidate: () => {},
        writeEvidence: () => {},
        certify: () => ({ certificate: { compilerPreparation: { usage: { total: 0 }, elapsedMs: 0 } } }),
        runSchedule: async ({ document }) => {
          scheduled = structuredClone(document);
        },
        finalizeResources: () => {},
      },
    });
    assert.equal(scheduled.runStatus, "running");
    assert.equal(scheduled.completed, false);
    assert.deepEqual(scheduled.gate, { passed: false });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("schedule marks complete and interrupted runs explicitly", async () => {
  for (const scenario of ["completed", "interrupted"]) {
    const document = scheduleDocument();
    let exitCode;
    const execution = runPairedBenchmarkSchedule(
      {
        options: {}, output: "/nonexistent/output", scratchRoot: "/nonexistent/scratch",
        runtimeSnapshot: "/runtime", runtimeSha256: "a".repeat(64), schedule: [pair], document,
        deadline: Date.now() + 60_000,
      },
      {
        hashRuntime: () => "a".repeat(64),
        runCell: async ({ mode }) => {
          if (scenario === "interrupted") throw new BenchmarkInterruptedError("SIGINT");
          return passedSample(mode);
        },
        writeEvidence: () => {},
        setExitCode: (value) => {
          exitCode = value;
        },
      },
    );
    if (scenario === "interrupted") await assert.rejects(execution, BenchmarkInterruptedError);
    else await execution;
    assert.equal(document.runStatus, scenario);
    assert.equal(document.completed, scenario === "completed");
    assert.equal(document.gate.passed, scenario === "completed");
    assert.equal(exitCode, undefined);
    if (scenario === "interrupted") assert.equal(document.gate.failure.reason, "benchmark interrupted by SIGINT");
  }
});

test("liveness treats requirement definition as planning rather than mutation", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-paired-requirement-phase-"));
  const activePath = join(root, "recording.jsonl.active");
  const progressPath = join(root, "progress.jsonl");
  let elapsedMs = 0;
  writeFileSync(activePath, "");
  const monitor = createCellLivenessMonitor({
    progressPath,
    activeRecordingPath: activePath,
    finalRecordingPath: join(root, "recording.jsonl.br"),
    now: () => 1_000 + elapsedMs,
    schedule: () => ({ fake: true }),
    cancel: () => {},
  });
  const event = (value) => appendFileSync(activePath, `${JSON.stringify(value)}\n`);
  try {
    elapsedMs = 100;
    event({ type: "tool_execution_start", toolCallId: "define", toolName: "record_requirement_audit", args: { action: "define" } });
    monitor.heartbeat();
    event({ type: "tool_execution_end", toolCallId: "define", toolName: "record_requirement_audit" });
    monitor.heartbeat();
    elapsedMs = 2_000;
    event({ type: "tool_execution_start", toolCallId: "write", toolName: "write", args: { path: "private.ts" } });
    monitor.heartbeat();
    event({ type: "tool_execution_end", toolCallId: "write", toolName: "write" });
    monitor.heartbeat();
    await monitor.finalize({ outcome: "failed" });
    const records = brotliDecompressSync(readFileSync(`${progressPath}.br`)).toString("utf8").trim().split("\n").map(JSON.parse);
    assert.equal(records[1].phase, "requirement_definition");
    assert.equal(records[1].requirementDefinitionAttemptCount, null);
    assert.equal(records[1].observedRequirementDefinitionAttemptCount, 1);
    assert.equal(records[1].mutationCount, 0);
    assert.equal(records[1].firstMutationElapsedMs ?? null, null);
    assert.equal(records[2].phase, "planning");
    assert.equal(records[3].phase, "implementation");
    assert.equal(records[3].mutationCount, 1);
    assert.equal(records[3].firstMutationElapsedMs, 2_000);
    assert.equal(records[4].phase, "idle");
    assert.equal(existsSync(progressPath), false);
    assert.equal(statSync(`${progressPath}.br`).mode & 0o777, 0o600);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("aborting a resistant paired child escalates and waits for close", { timeout: 3_000 }, async () => {
  const controller = new AbortController();
  const startedAt = Date.now();
  setTimeout(() => controller.abort(new BenchmarkInterruptedError("SIGTERM")), 250);
  const result = await runBenchmarkChild(
    process.execPath,
    ["-e", 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);'],
    { stdio: "ignore" },
    undefined,
    { signal: controller.signal, killGraceMs: 50 },
  );
  assert.equal(result.signal, "SIGKILL");
  assert.ok(result.interruption instanceof BenchmarkInterruptedError);
  assert.ok(Date.now() - startedAt < 2_000);
});

test("a child spawn error does not settle before close", async () => {
  const child = new EventEmitter();
  child.kill = () => true;
  let settled = false;
  const resultPromise = runBenchmarkChild("unused", [], {}, undefined, { spawn: () => child }).then((result) => {
    settled = true;
    return result;
  });
  const spawnError = new Error("spawn failed");
  child.emit("error", spawnError);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  child.emit("close", null, null);
  const result = await resultPromise;
  assert.equal(result.error, spawnError);
});

for (const [signalName, exitCode] of [["SIGINT", 130], ["SIGTERM", 143]]) {
test(`${signalName} writes terminal evidence and removes every owned private root`, { timeout: 5_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "p-paired-signal-process-"));
  const runtime = join(root, "runtime");
  const scratch = join(root, "scratch");
  const privateRoot = join(root, "private");
  const output = join(root, "run-v5.0.1-rc.1-signal-process");
  for (const path of [runtime, scratch, privateRoot, join(root, "packages", "coding-agent", "dist")]) {
    mkdirSync(path, { recursive: true });
  }
  const authPath = join(privateRoot, "auth.json");
  const modelsPath = join(privateRoot, "models.json");
  writeFileSync(join(root, "AGENTS.md"), "rules\n");
  writeFileSync(join(root, "packages", "coding-agent", "dist", "cli.js"), "runtime\n");
  writeFileSync(authPath, "{}\n");
  writeFileSync(modelsPath, "{}\n");
  const benchmarkModule = pathToFileURL(join(process.cwd(), "scripts", "benchmark-project-instructions.js")).href;
  const scheduleModule = pathToFileURL(join(process.cwd(), "scripts", "benchmark-project-instructions-schedule.js")).href;
  const interruptionModule = pathToFileURL(join(process.cwd(), "scripts", "benchmark-interruption.js")).href;
  const source = `
    import { rmSync } from "node:fs";
    import { runProjectInstructionsBenchmark } from ${JSON.stringify(benchmarkModule)};
    import { runPairedBenchmarkSchedule } from ${JSON.stringify(scheduleModule)};
    import { createBenchmarkSignalController } from ${JSON.stringify(interruptionModule)};
    const controller = createBenchmarkSignalController();
    try {
      await runProjectInstructionsBenchmark({
        argv: ["--model", "provider/model", "--task", "event-sourced-inventory", "--output", ${JSON.stringify(output)}],
        environment: { P_BENCHMARK_CANDIDATE_VERSION: "5.0.1-rc.1" },
        root: ${JSON.stringify(root)}, signal: controller.signal,
        dependencies: {
          createResources: () => ({ runtimeSnapshot: ${JSON.stringify(runtime)}, scratchRoot: ${JSON.stringify(scratch)}, privateSnapshots: { auth: { path: ${JSON.stringify(authPath)} }, models: { path: ${JSON.stringify(modelsPath)} }, dispose() {} }, dispose() { for (const path of [${JSON.stringify(runtime)}, ${JSON.stringify(scratch)}, ${JSON.stringify(privateRoot)}]) rmSync(path, { recursive: true, force: true }); } }),
          createAuthOutputGuard: () => undefined, privateInputEvidence: () => ({}),
          hashRuntime: () => "a".repeat(64), registerCandidate: () => {},
          certify: () => ({ certificate: { compilerPreparation: { usage: { total: 0 }, elapsedMs: 0 } } }),
          runSchedule: (context) => runPairedBenchmarkSchedule(context, {
            hashRuntime: () => "a".repeat(64), setExitCode() {},
            runCell: async ({ signal }) => {
              const keepAlive = setInterval(() => {}, 1_000);
              process.stdout.write("READY\\n");
              try {
                await new Promise((_, reject) => {
                  if (signal.aborted) reject(signal.reason);
                  else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
                });
              } finally { clearInterval(keepAlive); }
            },
          }),
        },
      });
    } finally { controller.dispose(); }
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
    cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (text) => {
    stderr += text;
  });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (text) => {
        if (text.includes("READY")) resolve();
      });
      child.once("error", reject);
    });
    child.kill(signalName);
    const exit = await new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
    assert.deepEqual(exit, { code: exitCode, signal: null }, stderr);
    const results = JSON.parse(readFileSync(join(output, "results.json"), "utf8"));
    const report = readFileSync(join(output, "report.md"), "utf8");
    assert.equal(results.runStatus, "interrupted");
    assert.equal(results.completed, false);
    assert.equal(results.gate.passed, false);
    assert.equal(results.samples.length, 0);
    assert.equal(results.summary, null);
    assert.match(report, /Correctness gate: \*\*INTERRUPTED\*\*/u);
    assert.doesNotMatch(report, /Correctness gate: \*\*(?:PASSED|RUNNING)\*\*/u);
    for (const path of [runtime, scratch, privateRoot]) assert.equal(existsSync(path), false);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    rmSync(root, { recursive: true, force: true });
  }
});
}
