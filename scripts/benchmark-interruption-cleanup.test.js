import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BenchmarkInterruptedError, createBenchmarkSignalController } from "./benchmark-interruption.js";
import {
  abortBenchmarkRecording,
  finalizeBenchmarkAgentResources,
} from "./benchmark-agent-resources-finalization.js";
import {
  benchmarkStartupProbeFailure,
  finalizeBenchmarkStartupEvidence,
} from "./benchmark-startup-probe-finalization.js";
import { runProjectInstructionsBenchmark } from "./benchmark-project-instructions.js";
import { runPairedBenchmarkSchedule } from "./benchmark-project-instructions-schedule.js";
test("agent recording and resource cleanup failures preserve interruption", async () => {
  const interruption = new BenchmarkInterruptedError("SIGINT");
  const recordingError = new Error("recording cleanup failed");
  await assert.rejects(
    abortBenchmarkRecording({ abort: async () => { throw recordingError; } }, interruption),
    (error) => error === interruption && error.cleanupErrors?.[0] === recordingError,
  );
  const controller = new AbortController();
  const resourceInterruption = new BenchmarkInterruptedError("SIGINT");
  controller.abort(resourceInterruption);
  const calls = [];
  assert.throws(
    () => finalizeBenchmarkAgentResources(
      { dirs: { pi: "/pi", p: "/p" }, dispose: () => { calls.push("dispose"); throw new Error("dispose"); } },
      { capture: (path) => { calls.push(path); throw new Error("capture"); }, sanitizeTree: () => { calls.push("sanitize"); throw new Error("sanitize"); } },
      "/output",
      controller.signal,
    ),
    (error) => error === resourceInterruption && error.cleanupErrors.length === 4,
  );
  assert.deepEqual(calls, ["/pi/auth.json", "/p/auth.json", "dispose", "sanitize"]);
});
test("startup probes preserve signal identity through diagnostics failure", () => {
  const interruption = new BenchmarkInterruptedError("SIGTERM");
  const evidence = { status: "running" };
  assert.equal(benchmarkStartupProbeFailure(interruption, evidence, "/diagnostics"), interruption);
  assert.equal(evidence.status, "failed");
  assert.throws(
    () => finalizeBenchmarkStartupEvidence("/nonexistent/private/diagnostics", evidence, interruption),
    (error) => error === interruption && error.cleanupErrors.length === 1,
  );
});
test("publication and resource-finalization failures remain secondary to interruption", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-paired-cleanup-interrupt-"));
  const runtimeSnapshot = join(root, "runtime");
  const scratchRoot = join(root, "scratch");
  const privateRoot = join(root, "private");
  const output = join(root, "run-v5.0.1-rc.1-cleanup-interrupt");
  let interruption;
  const publicationError = new Error("terminal publication failed");
  const cleanupError = new Error("resource cleanup failed");
  const target = new EventEmitter();
  const signalController = createBenchmarkSignalController(target);
  const documents = [];
  let finalized = false;
  for (const path of [runtimeSnapshot, scratchRoot, privateRoot, join(root, "packages", "coding-agent", "dist")]) {
    mkdirSync(path, { recursive: true });
  }
  const authPath = join(privateRoot, "auth.json");
  const modelsPath = join(privateRoot, "models.json");
  writeFileSync(join(root, "AGENTS.md"), "rules\n");
  writeFileSync(join(root, "packages", "coding-agent", "dist", "cli.js"), "runtime\n");
  writeFileSync(authPath, "{}\n");
  writeFileSync(modelsPath, "{}\n");
  try {
    await assert.rejects(
      runProjectInstructionsBenchmark({
        argv: ["--model", "provider/model", "--output", output],
        environment: { P_BENCHMARK_CANDIDATE_VERSION: "5.0.1-rc.1" },
        root,
        signal: signalController.signal,
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
          certify: async () => {
            target.emit("SIGTERM");
            interruption = signalController.signal.reason;
            throw interruption;
          },
          writeEvidence: (_output, document) => {
            documents.push(structuredClone(document));
            if (document.runStatus === "interrupted") {
              assert.equal(finalized, true);
              throw publicationError;
            }
          },
          finalizeResources: () => {
            finalized = true;
            throw cleanupError;
          },
        },
      }),
      (error) =>
        error === interruption &&
        error.cleanupErrors?.[0] === cleanupError &&
        error.cleanupErrors?.[1] === publicationError,
    );
    const results = documents.at(-1);
    assert.equal(results.runStatus, "interrupted");
    assert.equal(results.gate.passed, false);
    assert.equal(results.cleanup.status, "failed");
    assert.match(results.cleanup.diagnostic, /resource finalization failed/u);
    assert.doesNotMatch(JSON.stringify(results.cleanup), /resource cleanup failed|terminal publication failed/u);
    assert.equal(target.exitCode, 143);
  } finally {
    signalController.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});
test("schedule leaves terminal publication to global finalization", async () => {
  const interruption = new BenchmarkInterruptedError("SIGINT");
  const document = {
    schedule: [], samples: [], runStatus: "running", completed: false, gate: { passed: false },
  };
  let publicationCount = 0;
  await assert.rejects(
    runPairedBenchmarkSchedule(
      {
        options: {}, output: "/output", scratchRoot: "/scratch", runtimeSnapshot: "/runtime",
        runtimeSha256: "a".repeat(64),
        schedule: [{ run: 1, task: "task", modes: ["legacy"] }],
        document,
        deadline: Date.now() + 1_000,
      },
      {
        hashRuntime: () => "a".repeat(64),
        runCell: async () => { throw interruption; },
        writeEvidence: () => { publicationCount += 1; },
        setExitCode: () => {},
      },
    ),
    (error) => error === interruption,
  );
  assert.equal(document.runStatus, "interrupted");
  assert.equal(publicationCount, 0);
});
test("an aborted signal dominates returned samples and secondary cell errors", async () => {
  for (const outcome of ["returned", "threw"]) {
    const controller = new AbortController();
    const interruption = new BenchmarkInterruptedError("SIGINT");
    const secondary = new Error("secondary cell cleanup failure");
    const document = {
      schedule: [], samples: [], runStatus: "running", completed: false, gate: { passed: false },
    };
    await assert.rejects(
      runPairedBenchmarkSchedule(
        {
          options: {}, output: "/output", scratchRoot: "/scratch", runtimeSnapshot: "/runtime",
          runtimeSha256: "a".repeat(64), schedule: [{ run: 1, task: "task", modes: ["legacy"] }],
          document, deadline: Date.now() + 1_000, signal: controller.signal,
        },
        {
          hashRuntime: () => "a".repeat(64), writeEvidence: () => {},
          setExitCode: () => { throw new Error("must not set exit 2"); },
          runCell: async () => {
            controller.abort(interruption);
            if (outcome === "threw") throw secondary;
            return {
              run: 1, task: "task", mode: "legacy", status: "passed", elapsedMs: 1,
              metrics: { usage: { totalTokens: 1 } },
              quality: { passed: true, rawScore: 1, maxScore: 1, checks: [{ passed: true }] },
            };
          },
        },
      ),
      (error) => error === interruption && (outcome === "returned" || error.cleanupErrors?.[0] === secondary),
    );
    assert.equal(document.runStatus, "interrupted");
    assert.equal(document.completed, false);
    assert.equal(document.gate.passed, false);
  }
});
test("successful global finalization precedes terminal publication", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-paired-terminal-order-"));
  const runtimeSnapshot = join(root, "runtime");
  const scratchRoot = join(root, "scratch");
  const privateRoot = join(root, "private");
  const output = join(root, "run-v5.0.1-rc.1-terminal-order");
  for (const path of [runtimeSnapshot, scratchRoot, privateRoot, join(root, "packages", "coding-agent", "dist")]) {
    mkdirSync(path, { recursive: true });
  }
  const authPath = join(privateRoot, "auth.json");
  const modelsPath = join(privateRoot, "models.json");
  writeFileSync(join(root, "AGENTS.md"), "rules\n");
  writeFileSync(join(root, "packages", "coding-agent", "dist", "cli.js"), "runtime\n");
  writeFileSync(authPath, "{}\n");
  writeFileSync(modelsPath, "{}\n");
  let finalized = false;
  const terminalDocuments = [];
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
        certify: () => ({ certificate: { compilerPreparation: { usage: { total: 0 }, elapsedMs: 0 } } }),
        runSchedule: async ({ document }) => {
          document.completed = true;
          document.runStatus = "completed";
          document.gate = { passed: true };
        },
        finalizeResources: () => { finalized = true; },
        writeEvidence: (_target, document) => {
          if (document.runStatus !== "running") {
            assert.equal(finalized, true);
            terminalDocuments.push(structuredClone(document));
          }
        },
      },
    });
    assert.equal(terminalDocuments.length, 1);
    assert.deepEqual(terminalDocuments[0].cleanup, { status: "completed" });
    assert.equal(terminalDocuments[0].gate.passed, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("failed global finalization revokes a completed gate before terminal publication", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-paired-terminal-cleanup-failure-"));
  const runtimeSnapshot = join(root, "runtime");
  const scratchRoot = join(root, "scratch");
  const privateRoot = join(root, "private");
  const output = join(root, "run-v5.0.1-rc.1-terminal-cleanup-failure");
  for (const path of [runtimeSnapshot, scratchRoot, privateRoot, join(root, "packages", "coding-agent", "dist")]) {
    mkdirSync(path, { recursive: true });
  }
  const authPath = join(privateRoot, "auth.json");
  const modelsPath = join(privateRoot, "models.json");
  const cleanupError = new Error("private cleanup detail");
  const terminalDocuments = [];
  writeFileSync(join(root, "AGENTS.md"), "rules\n");
  writeFileSync(join(root, "packages", "coding-agent", "dist", "cli.js"), "runtime\n");
  writeFileSync(authPath, "{}\n");
  writeFileSync(modelsPath, "{}\n");
  try {
    await assert.rejects(
      runProjectInstructionsBenchmark({
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
          certify: () => ({ certificate: { compilerPreparation: { usage: { total: 0 }, elapsedMs: 0 } } }),
          runSchedule: async ({ document }) => {
            document.completed = true;
            document.runStatus = "completed";
            document.gate = { passed: true };
          },
          finalizeResources: () => { throw cleanupError; },
          writeEvidence: (_target, document) => {
            if (document.runStatus !== "running") terminalDocuments.push(structuredClone(document));
          },
        },
      }),
      (error) => error === cleanupError,
    );
    assert.equal(terminalDocuments.length, 1);
    assert.equal(terminalDocuments[0].runStatus, "failed");
    assert.equal(terminalDocuments[0].completed, false);
    assert.equal(terminalDocuments[0].gate.passed, false);
    assert.deepEqual(terminalDocuments[0].cleanup, {
      status: "failed",
      diagnostic: "Benchmark resource finalization failed",
    });
    assert.doesNotMatch(JSON.stringify(terminalDocuments[0]), /private cleanup detail/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
