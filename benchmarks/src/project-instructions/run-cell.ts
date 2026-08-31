import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  attachBenchmarkCleanupError,
  isBenchmarkInterruptedError,
  throwIfBenchmarkInterrupted,
} from "../harness/interruption.ts";
import { settlePairedCellEvidence } from "../harness/paired-resources.ts";
import * as privateInputs from "../harness/private-input-snapshots.ts";
import { benchmarkRecordingPaths } from "../harness/recording-lifecycle.ts";
import { benchmarkRunnerPath, hashRuntimeSnapshot } from "../harness/runtime-snapshot.ts";
import type { ProjectInstructionAuthority } from "./outer-authority.ts";
import { createProjectInstructionOuterAuthorityCapture } from "./outer-authority.ts";
import { createProjectInstructionProofReceipt } from "./proof-ipc.ts";
import { runBenchmarkChild } from "./run-child-process.ts";
import { BenchmarkChildResultError, readBenchmarkChildResult } from "./run-child-result.ts";
import type { PairedSample, ProjectInstructionCondition, RunOptions } from "./run-core.ts";
import { buildBenchmarkArgs, conditionConfiguration } from "./run-core.ts";
import { attachPairedBenchmarkLiveness } from "./run-failure.ts";
import { createCellLivenessMonitor } from "./run-liveness.ts";
import { createValidatedPairedSample } from "./run-sample.ts";
import {
  assertLegacyCellUnseeded,
  materializeBenchmarkProjectInstructions,
  verifyBenchmarkProjectInstructionMaterialization,
} from "./seed-runner.ts";
import { taskVerificationSemanticFailure } from "./verification-semantic-proof.ts";

const defaultOperations = {
  verifyPrivateInputs: privateInputs.verifyBenchmarkPrivateInputSnapshots,
  assertLegacyUnseeded: assertLegacyCellUnseeded,
  materializeCompiled: materializeBenchmarkProjectInstructions,
  verifyMaterialization: verifyBenchmarkProjectInstructionMaterialization,
  hashRuntime: (runtimeSnapshot: string) => hashRuntimeSnapshot(runtimeSnapshot, process.execPath),
  buildArgs: buildBenchmarkArgs,
  resolveRunner: benchmarkRunnerPath,
  buildEnvironment: (snapshots: Parameters<typeof privateInputs.benchmarkPrivateInputEnvironment>[0]) =>
    privateInputs.benchmarkPrivateInputEnvironment(snapshots, process.env),
  runChild: runBenchmarkChild,
  createMonitor: createCellLivenessMonitor,
  readResult: readBenchmarkChildResult,
  createSample: createValidatedPairedSample,
  settleEvidence: settlePairedCellEvidence,
  createProofReceipt: createProjectInstructionProofReceipt,
};

type PrivateSnapshots = Parameters<typeof privateInputs.verifyBenchmarkPrivateInputSnapshots>[0];
type CellOptions = Omit<RunOptions, "seed"> & {
  privateSnapshots: PrivateSnapshots;
  seed: Parameters<typeof materializeBenchmarkProjectInstructions>[0]["seed"];
  sourceSha256: string;
  authOutputGuard: Parameters<typeof settlePairedCellEvidence>[0];
  authFiles: Parameters<typeof settlePairedCellEvidence>[1];
};
export type PairedCellContext = {
  options: CellOptions;
  pair: { run: number; task: string };
  condition: ProjectInstructionCondition;
  cellOutput: string;
  scratchOutput: string;
  remainingSeconds: number;
  runtimeSnapshot: string;
  runtimeSha256: string;
  progressPath: string;
  output: string;
  repoRoot: string;
  signal?: AbortSignal;
};
type CellCapture = {
  recordingCapture?: Parameters<ReturnType<typeof createCellLivenessMonitor>["finalize"]>[0]["recordingCapture"];
  captureOverflow?: Parameters<ReturnType<typeof createCellLivenessMonitor>["finalize"]>[0]["captureOverflow"];
};
type CellOperations = typeof defaultOperations;

function isAuthority(value: unknown): value is ProjectInstructionAuthority {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "resultSha256" in value &&
    typeof value.resultSha256 === "string" &&
    "expectedTurnCount" in value &&
    typeof value.expectedTurnCount === "number" &&
    "baseSystemModeProofs" in value &&
    Array.isArray(value.baseSystemModeProofs) &&
    "userTurns" in value &&
    Array.isArray(value.userTurns)
  );
}

function finalizationOptions(outcome: string, capture: CellCapture | undefined) {
  return {
    outcome,
    requireSemanticEvidence: true,
    captureMetadataValid: capture !== undefined,
    recordingCapture: capture?.recordingCapture,
    captureOverflow: capture?.captureOverflow,
  };
}

function settleCellEvidence(
  operations: CellOperations,
  options: CellOptions,
  context: PairedCellContext,
  scratchOutput: string,
  trustedChildCompletion: boolean,
  pendingError: unknown,
): void {
  try {
    operations.settleEvidence(
      options.authOutputGuard,
      options.authFiles,
      scratchOutput,
      context.cellOutput,
      trustedChildCompletion,
    );
  } catch (cleanupError) {
    if (isBenchmarkInterruptedError(pendingError)) {
      throw attachBenchmarkCleanupError(pendingError, cleanupError);
    }
    throw cleanupError;
  }
}

export async function runPairedBenchmarkCell(
  context: PairedCellContext,
  operationOverrides: Partial<CellOperations> = {},
): Promise<PairedSample> {
  const operations = { ...defaultOperations, ...operationOverrides };
  const { options, pair, condition, scratchOutput, runtimeSnapshot, runtimeSha256 } = context;
  const configuration = conditionConfiguration(condition);
  let trustedChildCompletion = false;
  let livenessFinalized = false;
  let liveness: Awaited<ReturnType<ReturnType<typeof createCellLivenessMonitor>["finalize"]>> | undefined;
  let monitor: ReturnType<typeof createCellLivenessMonitor> | undefined;
  let capture: CellCapture | undefined;
  let pendingError: unknown;
  try {
    throwIfBenchmarkInterrupted(context.signal);
    if (!operations.verifyPrivateInputs(options.privateSnapshots)) {
      throw new Error("ephemeral private benchmark inputs changed before the benchmark cell");
    }
    let seedMaterialization: Awaited<ReturnType<typeof materializeBenchmarkProjectInstructions>> | undefined;
    if (configuration.projectInstructionMode === "compiled") {
      seedMaterialization = await operations.materializeCompiled({
        runtimeSnapshot,
        sourceFile: options.projectInstructionsFile,
        scratchOutput,
        task: pair.task,
        seed: options.seed,
        signal: context.signal,
      });
    } else {
      operations.assertLegacyUnseeded(scratchOutput, pair.task);
    }
    if (operations.hashRuntime(runtimeSnapshot) !== runtimeSha256) {
      throw new Error("immutable P runtime changed during project-instruction preseed");
    }
    throwIfBenchmarkInterrupted(context.signal);
    const proofReceipt = operations.createProofReceipt({
      runtimeSha256,
      run: pair.run,
      task: pair.task,
      mode: configuration.projectInstructionMode,
      taskVerificationMode: configuration.taskVerificationMode,
      sourceSha256: options.sourceSha256,
    });
    const authorityCapture = createProjectInstructionOuterAuthorityCapture(proofReceipt.sha256);
    const args = operations.buildArgs(options, pair, condition, scratchOutput, context.remainingSeconds, proofReceipt);
    const finalRecordingPath = join(scratchOutput, "recordings", `p-run-1-${pair.task}.jsonl.br`);
    const recordingPaths = benchmarkRecordingPaths(finalRecordingPath);
    monitor = operations.createMonitor({
      workspace: join(scratchOutput, "workspaces", "p", "run-1", pair.task),
      activeRecordingPath: recordingPaths.activePath,
      chunkDirectory: recordingPaths.chunkDirectory,
      finalRecordingPath,
      manifestPath: recordingPaths.manifestPath,
      progressPath: context.progressPath,
      evidenceRoot: context.output,
      label: `run ${pair.run} ${pair.task}/${condition}`,
    });
    const child = await operations.runChild(
      process.execPath,
      [operations.resolveRunner(runtimeSnapshot), ...args],
      {
        cwd: context.repoRoot,
        env: operations.buildEnvironment(options.privateSnapshots),
        stdio: ["inherit", "inherit", "inherit", "ipc"],
      },
      authorityCapture,
      { signal: context.signal },
    );
    if (child.interruption) throw child.interruption;
    if (child.error) throw new Error("child benchmark failed to start", { cause: child.error });
    if (child.status !== 0) throw new Error(`child benchmark exited ${child.status ?? "without a status"}`);
    if (operations.hashRuntime(runtimeSnapshot) !== runtimeSha256) {
      throw new Error("immutable P runtime changed during the benchmark cell");
    }
    if (!operations.verifyPrivateInputs(options.privateSnapshots)) {
      throw new Error("ephemeral private benchmark inputs changed during the benchmark cell");
    }
    if (seedMaterialization) operations.verifyMaterialization(seedMaterialization);
    const authority = child.projectInstructionAuthority;
    if (!isAuthority(authority)) {
      throw new BenchmarkChildResultError(
        "missing_outer_authority",
        "child benchmark outer proof authority is missing",
      );
    }
    const parsed = operations.readResult(join(scratchOutput, "results.json"), authority.resultSha256);
    capture = { recordingCapture: parsed.recordingCapture, captureOverflow: parsed.captureOverflow };
    const sample = operations.createSample(parsed as unknown as Parameters<typeof createValidatedPairedSample>[0], {
      ...context,
      mode: configuration.projectInstructionMode,
      taskVerificationMode: configuration.taskVerificationMode,
      seedMaterialization,
      proofReceiptSha256: proofReceipt.sha256,
      projectInstructionAuthority: authority,
    });
    livenessFinalized = true;
    liveness = await monitor.finalize(finalizationOptions("process_completed", capture));
    if (liveness.semanticEvidenceAvailable !== true || liveness.semanticEvidenceComplete !== true) {
      throw new Error("child benchmark semantic evidence is incomplete");
    }
    const verificationFailure = liveness.taskVerification
      ? taskVerificationSemanticFailure(configuration.taskVerificationMode, liveness.taskVerification)
      : "child benchmark task-verification semantic evidence is missing";
    if (verificationFailure) throw new Error(verificationFailure);
    rmSync(recordingPaths.manifestPath, { force: true });
    trustedChildCompletion = true;
    return { ...sample, liveness };
  } catch (error) {
    if (monitor && !livenessFinalized) {
      livenessFinalized = true;
      const outcome = isBenchmarkInterruptedError(error) ? "interrupted" : "failed";
      try {
        liveness = await monitor.finalize(finalizationOptions(outcome, capture));
      } catch (cleanupError) {
        if (isBenchmarkInterruptedError(error)) attachBenchmarkCleanupError(error, cleanupError);
        else throw cleanupError;
      }
    }
    pendingError = liveness ? attachPairedBenchmarkLiveness(error, liveness) : error;
    throw pendingError;
  } finally {
    settleCellEvidence(operations, options, context, scratchOutput, trustedChildCompletion, pendingError);
  }
}
