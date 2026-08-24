import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { type BenchmarkInterruptedError, createBenchmarkSignalController } from "../../src/harness/interruption.ts";
import type { runPairedBenchmarkSchedule } from "../../src/project-instructions/run-schedule.ts";
import { runProjectInstructionsBenchmark } from "../../src/run-project-instructions.ts";

type PairedScheduleContext = Parameters<typeof runPairedBenchmarkSchedule>[0];
type PairedDocument = PairedScheduleContext["document"];
type ProjectBenchmarkInvocation = NonNullable<Parameters<typeof runProjectInstructionsBenchmark>[0]>;
type ProjectBenchmarkDependencies = NonNullable<ProjectBenchmarkInvocation["dependencies"]>;
test("publication and resource-finalization failures remain secondary to interruption", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-paired-cleanup-interrupt-"));
  const runtimeSnapshot = join(root, "runtime");
  const scratchRoot = join(root, "scratch");
  const privateRoot = join(root, "private");
  const output = join(root, "run-v5.0.1-rc.1-cleanup-interrupt");
  let interruption: BenchmarkInterruptedError | undefined;
  const publicationError = new Error("terminal publication failed");
  const cleanupError = new Error("resource cleanup failed");
  const target = Object.assign(new EventEmitter(), { exitCode: undefined as number | undefined });
  const signalController = createBenchmarkSignalController(
    target as unknown as Pick<NodeJS.Process, "exitCode" | "off" | "on">,
  );
  const documents: PairedDocument[] = [];
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
          writeEvidence: (_output: string, document: PairedDocument) => {
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
        } as unknown as ProjectBenchmarkDependencies,
      }),
      (error) =>
        interruption !== undefined &&
        error === interruption &&
        interruption.cleanupErrors?.[0] === cleanupError &&
        interruption.cleanupErrors?.[1] === publicationError,
    );
    const results = documents.at(-1);
    assert.ok(results);
    assert.ok(results.cleanup);
    assert.equal(results.runStatus, "interrupted");
    assert.equal(results.gate.passed, false);
    assert.equal(results.cleanup.status, "failed");
    assert.match(results.cleanup.diagnostic ?? "", /resource finalization failed/u);
    assert.doesNotMatch(JSON.stringify(results.cleanup), /resource cleanup failed|terminal publication failed/u);
    assert.equal(target.exitCode, 143);
  } finally {
    signalController.dispose();
    rmSync(root, { recursive: true, force: true });
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
  const terminalDocuments: PairedDocument[] = [];
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
        runSchedule: async ({ document }: PairedScheduleContext) => {
          document.completed = true;
          document.runStatus = "completed";
          document.gate = { passed: true };
        },
        finalizeResources: () => {
          finalized = true;
        },
        writeEvidence: (_target: string, document: PairedDocument) => {
          if (document.runStatus !== "running") {
            assert.equal(finalized, true);
            terminalDocuments.push(structuredClone(document));
          }
        },
      } as unknown as ProjectBenchmarkDependencies,
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
  const terminalDocuments: PairedDocument[] = [];
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
          runSchedule: async ({ document }: PairedScheduleContext) => {
            document.completed = true;
            document.runStatus = "completed";
            document.gate = { passed: true };
          },
          finalizeResources: () => {
            throw cleanupError;
          },
          writeEvidence: (_target: string, document: PairedDocument) => {
            if (document.runStatus !== "running") terminalDocuments.push(structuredClone(document));
          },
        } as unknown as ProjectBenchmarkDependencies,
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
