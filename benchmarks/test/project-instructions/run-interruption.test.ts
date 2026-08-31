import assert from "node:assert/strict";
import type { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { brotliDecompressSync } from "node:zlib";

import { BenchmarkInterruptedError } from "../../src/harness/interruption.ts";
import { runBenchmarkChild } from "../../src/project-instructions/run-child-process.ts";
import type {
  PairedSample,
  PairedScheduleCell,
  ProjectInstructionCondition,
} from "../../src/project-instructions/run-core.ts";
import { conditionConfiguration } from "../../src/project-instructions/run-core.ts";
import { createCellLivenessMonitor } from "../../src/project-instructions/run-liveness.ts";
import { runPairedBenchmarkSchedule } from "../../src/project-instructions/run-schedule.ts";
import { createTaskVerificationSemanticTracker } from "../../src/project-instructions/verification-semantic-proof.ts";
import { runProjectInstructionsBenchmark } from "../../src/run-project-instructions.ts";

const pair: PairedScheduleCell = {
  run: 1,
  task: "event-sourced-inventory",
  conditions: ["legacy", "compiled-evidence", "compiled-audit"],
};
const privateSnapshots = {
  models: { path: "", present: false, sha256: "", dispose() {} },
  auth: { path: "", present: false, dispose() {} },
  dispose() {},
};

function passedSample(condition: ProjectInstructionCondition): PairedSample {
  const configuration = conditionConfiguration(condition);
  const verificationMode = configuration.taskVerificationMode;
  if (verificationMode === "off") throw new Error(`${condition} must exercise task verification`);
  return {
    run: 1,
    task: pair.task,
    condition,
    mode: configuration.projectInstructionMode,
    taskVerificationMode: verificationMode,
    status: "passed",
    elapsedMs: 1,
    metrics: { usage: { totalTokens: 1 } },
    quality: { passed: true, rawScore: 1, maxScore: 1, checks: [{ passed: true }] },
    liveness: {
      semanticEvidenceAvailable: true,
      semanticEvidenceComplete: true,
      taskVerification: completedTaskVerificationProof(verificationMode),
    },
  };
}

function completedTaskVerificationProof(mode: "evidence" | "audit") {
  const tracker = createTaskVerificationSemanticTracker();
  const complete = (id: string, toolName: string, args: Record<string, unknown>, text: string) => {
    tracker.start({ type: "tool_execution_start", toolCallId: id, toolName, args });
    tracker.end({
      type: "tool_execution_end",
      toolCallId: id,
      toolName,
      isError: false,
      result: { content: [{ type: "text", text }] },
    });
  };
  complete(
    "ready",
    "record_task_verification",
    { action: "ready_to_finish" },
    mode === "evidence" ? "verification_token: evidence-token" : "Define requirements",
  );
  if (mode === "audit") {
    complete("define", "record_requirement_audit", { action: "define" }, "Requirements defined");
    complete("verdict", "record_requirement_audit", { action: "verdict" }, "verification_token: audit-token");
  }
  complete("finish", "finish_work", { verification_token: "accepted-token" }, "Work completed");
  return tracker.snapshot();
}

function scheduleDocument(): Parameters<typeof runPairedBenchmarkSchedule>[0]["document"] {
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
  let scheduled: Parameters<typeof runPairedBenchmarkSchedule>[0]["document"] | undefined;
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
        runSchedule: async ({ document }: Parameters<typeof runPairedBenchmarkSchedule>[0]) => {
          scheduled = structuredClone(document);
        },
        finalizeResources: () => {},
      } as unknown as NonNullable<NonNullable<Parameters<typeof runProjectInstructionsBenchmark>[0]>["dependencies"]>,
    });
    assert.ok(scheduled);
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
    let exitCode: number | undefined;
    const execution = runPairedBenchmarkSchedule(
      {
        options: {
          privateSnapshots,
          authFiles: [],
          model: "provider/model",
          sourceSha256: "a".repeat(64),
        } as unknown as Parameters<typeof runPairedBenchmarkSchedule>[0]["options"],
        output: "/nonexistent/output",
        scratchRoot: "/nonexistent/scratch",
        runtimeSnapshot: "/runtime",
        runtimeSha256: "a".repeat(64),
        schedule: [pair],
        document,
        deadline: Date.now() + 60_000,
        repoRoot: "/repo",
      },
      {
        hashRuntime: () => "a".repeat(64),
        runCell: async ({ condition }) => {
          if (scenario === "interrupted") throw new BenchmarkInterruptedError("SIGINT");
          return passedSample(condition);
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
    if (scenario === "interrupted") assert.equal(document.gate.failure?.reason, "benchmark interrupted by SIGINT");
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
  const event = (value: unknown) => appendFileSync(activePath, `${JSON.stringify(value)}\n`);
  try {
    elapsedMs = 100;
    event({
      type: "tool_execution_start",
      toolCallId: "define",
      toolName: "record_requirement_audit",
      args: { action: "define" },
    });
    monitor.heartbeat();
    event({ type: "tool_execution_end", toolCallId: "define", toolName: "record_requirement_audit" });
    monitor.heartbeat();
    elapsedMs = 2_000;
    event({ type: "tool_execution_start", toolCallId: "write", toolName: "write", args: { path: "private.ts" } });
    monitor.heartbeat();
    event({ type: "tool_execution_end", toolCallId: "write", toolName: "write" });
    monitor.heartbeat();
    await monitor.finalize({ outcome: "failed" });
    const records = brotliDecompressSync(readFileSync(`${progressPath}.br`))
      .toString("utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const heartbeats = records.filter((record) => record.event === "heartbeat");
    assert.equal(heartbeats[0].phase, "requirement_definition");
    assert.equal(heartbeats[0].requirementDefinitionAttemptCount, null);
    assert.equal(heartbeats[0].observedRequirementDefinitionAttemptCount, 1);
    assert.equal(heartbeats[0].mutationCount, 0);
    assert.equal(heartbeats[0].firstMutationElapsedMs ?? null, null);
    assert.equal(heartbeats[1].phase, "planning");
    assert.equal(heartbeats[2].phase, "implementation");
    assert.equal(heartbeats[2].mutationCount, 1);
    assert.equal(heartbeats[2].firstMutationElapsedMs, 2_000);
    assert.equal(heartbeats[3].phase, "idle");
    assert.equal(records.filter((record) => record.event === "requirement_definition_settled").length, 1);
    assert.equal(existsSync(progressPath), false);
    assert.equal(statSync(`${progressPath}.br`).mode & 0o777, 0o600);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("aborting a resistant paired child escalates and waits for close", { timeout: 3_000 }, async () => {
  const controller = new AbortController();
  const startedAt = Date.now();
  const result = await runBenchmarkChild(
    process.execPath,
    ["-e", 'process.on("SIGTERM", () => {}); process.send("ready"); setInterval(() => {}, 1000);'],
    { stdio: ["ignore", "ignore", "ignore", "ipc"] },
    {
      accept(message) {
        if (message === "ready") controller.abort(new BenchmarkInterruptedError("SIGTERM"));
      },
      finish() {},
    },
    { signal: controller.signal, killGraceMs: 50 },
  );
  assert.equal(result.signal, "SIGKILL");
  assert.ok(result.interruption instanceof BenchmarkInterruptedError);
  assert.ok(Date.now() - startedAt < 2_000);
});

test("a child spawn error does not settle before close", async () => {
  const child = Object.assign(new EventEmitter(), { kill: () => true });
  let settled = false;
  const spawnChild = (() => child as unknown as ReturnType<typeof spawn>) as typeof spawn;
  const resultPromise = runBenchmarkChild("unused", [], {}, undefined, { spawn: spawnChild }).then((result) => {
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
