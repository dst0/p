#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBenchmarkAuthOutputGuard } from "./harness/auth-output-guard.ts";
import { registerBenchmarkCandidate } from "./harness/candidate-registry.ts";
import { parseBenchmarkCandidateVersion, resolveBenchmarkCandidateOutput } from "./harness/candidate-version.ts";
import {
  attachBenchmarkCleanupError,
  benchmarkInterruptionFromSignal,
  createBenchmarkSignalController,
  isBenchmarkInterruptedError,
  throwIfBenchmarkInterrupted,
} from "./harness/interruption.ts";
import { createPairedBenchmarkResources, finalizePairedBenchmarkResources } from "./harness/paired-resources.ts";
import * as privateInputs from "./harness/private-input-snapshots.ts";
import {
  assertEmptyOutputDirectory,
  benchmarkProjectInstructionProbePath,
  hashRuntimeSnapshot,
} from "./harness/runtime-snapshot.ts";
import { hashFile } from "./project-instructions/evidence.ts";
import type { PairedCellContext } from "./project-instructions/run-cell.ts";
import { buildPairedSchedule, parsePairedArgs } from "./project-instructions/run-core.ts";
import { createClassifiedBenchmarkGateFailure } from "./project-instructions/run-failure.ts";
import { printPairedBenchmarkHelp } from "./project-instructions/run-help.ts";
import { writePairedBenchmarkEvidence } from "./project-instructions/run-output.ts";
import { runPairedBenchmarkSchedule } from "./project-instructions/run-schedule.ts";
import { certifyBenchmarkProjectInstructions } from "./project-instructions/seed-runner.ts";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(scriptPath), "..", "..");
const codingAgentCli = join("packages", "coding-agent", "dist", "cli.js");
const timestampLabel = () => new Date().toISOString().replaceAll(/[:.]/gu, "-");
const cleanupDiagnostic = "Benchmark resource finalization failed";
type BenchmarkResources = ReturnType<typeof createPairedBenchmarkResources>;
type AuthOutputGuard = ReturnType<typeof createBenchmarkAuthOutputGuard>;
type BenchmarkDocument = Parameters<typeof writePairedBenchmarkEvidence>[1];
type BenchmarkDependencies = {
  pathExists: typeof existsSync;
  createResources: typeof createPairedBenchmarkResources;
  finalizeResources: typeof finalizePairedBenchmarkResources;
  createAuthOutputGuard: typeof createBenchmarkAuthOutputGuard;
  privateInputEvidence: typeof privateInputs.benchmarkPrivateInputEvidence;
  hashRuntime: typeof hashRuntimeSnapshot;
  registerCandidate: typeof registerBenchmarkCandidate;
  writeEvidence: typeof writePairedBenchmarkEvidence;
  certify: typeof certifyBenchmarkProjectInstructions;
  runSchedule: typeof runPairedBenchmarkSchedule;
};
type BenchmarkInvocation = {
  argv?: string[];
  environment?: NodeJS.ProcessEnv;
  root?: string;
  dependencies?: Partial<BenchmarkDependencies>;
  signal?: AbortSignal;
};

export async function runProjectInstructionsBenchmark({
  argv = process.argv.slice(2),
  environment = process.env,
  root = repoRoot,
  dependencies = {},
  signal,
}: BenchmarkInvocation = {}): Promise<void> {
  const pathExists = dependencies.pathExists ?? existsSync;
  const createResources = dependencies.createResources ?? createPairedBenchmarkResources;
  const finalizeResources = dependencies.finalizeResources ?? finalizePairedBenchmarkResources;
  const createAuthOutputGuard = dependencies.createAuthOutputGuard ?? createBenchmarkAuthOutputGuard;
  const privateInputEvidence = dependencies.privateInputEvidence ?? privateInputs.benchmarkPrivateInputEvidence;
  const hashRuntime = dependencies.hashRuntime ?? hashRuntimeSnapshot;
  const registerCandidate = dependencies.registerCandidate ?? registerBenchmarkCandidate;
  const writeEvidence = dependencies.writeEvidence ?? writePairedBenchmarkEvidence;
  const certify = dependencies.certify ?? certifyBenchmarkProjectInstructions;
  const runSchedule = dependencies.runSchedule ?? runPairedBenchmarkSchedule;
  let interruption: Error | undefined;
  let executionError: unknown;
  let document: BenchmarkDocument | undefined;
  const parsedOptions = parsePairedArgs(argv);
  if (parsedOptions.help) return printPairedBenchmarkHelp();
  if (!parsedOptions.model || !parsedOptions.compilerModel) {
    throw new Error("paired benchmark model resolution is incomplete");
  }
  const candidateVersion = parseBenchmarkCandidateVersion(environment.P_BENCHMARK_CANDIDATE_VERSION);
  const output = resolveBenchmarkCandidateOutput(root, parsedOptions.output, candidateVersion, timestampLabel());
  const source = join(root, "AGENTS.md");
  if (!pathExists(join(root, codingAgentCli))) throw new Error("P must be built before benchmarking");
  if (!pathExists(source)) throw new Error("Repository AGENTS.md is required for the paired benchmark");
  assertEmptyOutputDirectory(output);
  mkdirSync(join(output, "inputs"), { recursive: true });
  const projectInstructionsFile = join(output, "inputs", "AGENTS.md");
  copyFileSync(source, projectInstructionsFile);
  const authSource = join(homedir(), ".p", "agent", "auth.json");
  const resources: BenchmarkResources = createResources({
    repoRoot: root,
    temporaryParent: tmpdir(),
    modelsSource: parsedOptions.modelsFile,
    authSource,
    model: parsedOptions.model,
  });
  let authOutputGuard: AuthOutputGuard | undefined;
  try {
    const { runtimeSnapshot, scratchRoot, privateSnapshots } = resources;
    authOutputGuard = createAuthOutputGuard([authSource, privateSnapshots.auth.path]);
    const sourceSha256 = hashFile(projectInstructionsFile);
    const baseOptions = {
      ...parsedOptions,
      model: parsedOptions.model,
      compilerModel: parsedOptions.compilerModel,
      pCli: join(runtimeSnapshot, codingAgentCli),
      projectInstructionProbe: benchmarkProjectInstructionProbePath(runtimeSnapshot),
      projectInstructionsFile,
      privateSnapshots,
      authOutputGuard,
      authFiles: [authSource, privateSnapshots.auth.path],
      modelsFile: privateSnapshots.models.path,
      sourceSha256,
    };
    const seed = parsedOptions.seed ?? randomBytes(16).toString("hex");
    const runtimeSha256 = hashRuntime(runtimeSnapshot, process.execPath);
    registerCandidate(root, candidateVersion, runtimeSha256);
    const schedule = buildPairedSchedule(baseOptions.tasks, baseOptions.runs, seed);
    document = {
      schemaVersion: 1,
      candidateVersion,
      generatedAt: new Date().toISOString(),
      model: baseOptions.model,
      compilerModel: baseOptions.compilerModel,
      thinking: baseOptions.thinking,
      binarySha256: runtimeSha256,
      projectInstructionsSourceSha256: sourceSha256,
      ...privateInputEvidence(privateSnapshots),
      seed,
      runs: baseOptions.runs,
      tasks: baseOptions.tasks,
      schedule,
      samples: [],
      runStatus: "running",
      gate: { passed: false },
      completed: false,
    };
    writeEvidence(output, document);
    console.log(`Paired benchmark output: ${output}`);
    console.log(`Immutable P runtime SHA-256: ${runtimeSha256}`);
    console.log(`Project instruction source SHA-256: ${sourceSha256}`);
    console.log(`Randomization seed: ${seed}`);
    let certificationPassed = false;
    let certifiedOptions: PairedCellContext["options"] | undefined;
    try {
      throwIfBenchmarkInterrupted(signal);
      const certifiedSeed = await certify({
        scratchRoot,
        runtimeSnapshot,
        runtimeSha256,
        sourceFile: projectInstructionsFile,
        sourceSha256,
        privateSnapshots,
        compilerModel: baseOptions.compilerModel,
        authOutputGuard,
        signal,
      });
      certifiedOptions = { ...baseOptions, seed: certifiedSeed };
      document.compilerPreparation = certifiedSeed.certificate.compilerPreparation;
      writeEvidence(output, document);
      certificationPassed = true;
    } catch (error) {
      const interrupted = isBenchmarkInterruptedError(error) || signal?.aborted === true;
      const failureError = interrupted
        ? isBenchmarkInterruptedError(error)
          ? error
          : benchmarkInterruptionFromSignal(signal)
        : error;
      if (interrupted) {
        interruption =
          failureError instanceof Error ? failureError : new Error("benchmark interrupted", { cause: failureError });
      }
      document.runStatus = interrupted ? "interrupted" : "failed";
      document.gate = {
        passed: false,
        failure: createClassifiedBenchmarkGateFailure(
          { run: 0, task: "compiler-certification" },
          "compiled",
          failureError,
          interrupted ? {} : { compilerCertification: true },
        ),
      };
      if (!interrupted) process.exitCode = 2;
    }
    if (certificationPassed && certifiedOptions) {
      await runSchedule({
        options: certifiedOptions,
        output,
        scratchRoot,
        runtimeSnapshot,
        runtimeSha256,
        schedule,
        document,
        deadline: Date.now() + certifiedOptions.maxRuntimeSeconds * 1000,
        repoRoot: root,
        signal,
      });
    }
  } catch (error) {
    executionError = error;
    const interrupted = isBenchmarkInterruptedError(error) || signal?.aborted === true;
    interruption = interrupted
      ? isBenchmarkInterruptedError(error)
        ? error
        : benchmarkInterruptionFromSignal(signal)
      : interruption;
    if (document?.runStatus === "running") {
      document.completed = false;
      document.runStatus = interrupted ? "interrupted" : "failed";
      document.gate = {
        passed: false,
        failure: createClassifiedBenchmarkGateFailure(
          { run: 0, task: "benchmark-execution" },
          "unknown",
          interruption ?? error,
        ),
      };
    }
  }
  interruption ??= benchmarkInterruptionFromSignal(signal);
  if (interruption && document && document.runStatus !== "interrupted") {
    document.completed = false;
    document.runStatus = "interrupted";
    document.gate = {
      passed: false,
      failure: createClassifiedBenchmarkGateFailure({ run: 0, task: "benchmark-execution" }, "unknown", interruption),
    };
  }
  let cleanupError: unknown;
  try {
    finalizeResources(resources, authOutputGuard, output, [authSource, resources.privateSnapshots.auth.path]);
  } catch (error) {
    cleanupError = error;
  }
  if (document) {
    document.cleanup = cleanupError ? { status: "failed", diagnostic: cleanupDiagnostic } : { status: "completed" };
    if (cleanupError && document.gate.passed) {
      document.completed = false;
      document.runStatus = "failed";
      document.gate = {
        passed: false,
        failure: createClassifiedBenchmarkGateFailure(
          { run: 0, task: "global-resource-finalization" },
          "unknown",
          cleanupDiagnostic,
        ),
      };
    }
    if (cleanupError && interruption) attachBenchmarkCleanupError(interruption, cleanupError);
    try {
      writeEvidence(output, document);
    } catch (publicationError) {
      if (interruption) throw attachBenchmarkCleanupError(interruption, publicationError);
      if (cleanupError)
        throw new AggregateError([cleanupError, publicationError], "Benchmark cleanup and publication failed");
      throw publicationError;
    }
    console.log(`Report: ${join(output, "report.md")}`);
  }
  if (cleanupError) {
    if (interruption) throw interruption;
    throw cleanupError;
  }
  if (executionError) {
    if (interruption && executionError !== interruption)
      throw attachBenchmarkCleanupError(interruption, executionError);
    if (!interruption) throw executionError;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
  const signalController = createBenchmarkSignalController();
  try {
    await runProjectInstructionsBenchmark({ signal: signalController.signal });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    if (!isBenchmarkInterruptedError(error)) process.exitCode = 1;
  } finally {
    signalController.dispose();
  }
}
