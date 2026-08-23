import { rmSync } from "node:fs";
import { join } from "node:path";
import { buildBenchmarkArgs } from "./benchmark-project-instructions-core.js";
import { attachPairedBenchmarkLiveness } from "./benchmark-project-instructions-failure.js";
import { createCellLivenessMonitor, runBenchmarkChild } from "./benchmark-project-instructions-liveness.js";
import { readBenchmarkChildResult } from "./benchmark-project-instructions-child-result.js";
import { createValidatedPairedSample } from "./benchmark-project-instructions-sample.js";
import { benchmarkRunnerPath, hashRuntimeSnapshot } from "./benchmark-runtime-snapshot.js";
import * as privateInputs from "./benchmark-private-input-snapshots.js";
import { settlePairedCellEvidence } from "./benchmark-paired-resources.js";
import { benchmarkRecordingPaths } from "./benchmark-recording-lifecycle.js";
import {
  assertLegacyCellUnseeded,
  materializeBenchmarkProjectInstructions,
  verifyBenchmarkProjectInstructionMaterialization,
} from "./benchmark-project-instruction-seed-runner.js";

const defaultOperations = {
  verifyPrivateInputs: privateInputs.verifyBenchmarkPrivateInputSnapshots,
  assertLegacyUnseeded: assertLegacyCellUnseeded,
  materializeCompiled: materializeBenchmarkProjectInstructions,
  verifyMaterialization: verifyBenchmarkProjectInstructionMaterialization,
  hashRuntime: (runtimeSnapshot) => hashRuntimeSnapshot(runtimeSnapshot, process.execPath),
  buildArgs: buildBenchmarkArgs,
  resolveRunner: benchmarkRunnerPath,
  buildEnvironment: (snapshots) => privateInputs.benchmarkPrivateInputEnvironment(snapshots, process.env),
  runChild: runBenchmarkChild,
  createMonitor: createCellLivenessMonitor,
  readResult: readBenchmarkChildResult,
  createSample: createValidatedPairedSample,
  settleEvidence: settlePairedCellEvidence,
};

function finalizationOptions(outcome, capture) {
  return {
    outcome,
    requireSemanticEvidence: true,
    captureMetadataValid: capture !== undefined,
    recordingCapture: capture?.recordingCapture,
    captureOverflow: capture?.captureOverflow,
  };
}

export async function runPairedBenchmarkCell(context, operationOverrides = {}) {
  const operations = { ...defaultOperations, ...operationOverrides };
  const { options, pair, mode, scratchOutput, runtimeSnapshot, runtimeSha256 } = context;
  let trustedChildCompletion = false;
  let livenessFinalized = false;
  let liveness;
  let monitor;
  let capture;
  try {
    if (!operations.verifyPrivateInputs(options.privateSnapshots)) {
      throw new Error("ephemeral private benchmark inputs changed before the benchmark cell");
    }
    const seedMaterialization =
      mode === "compiled"
        ? operations.materializeCompiled({
            runtimeSnapshot,
            sourceFile: options.projectInstructionsFile,
            scratchOutput,
            task: pair.task,
            seed: options.seed,
          })
        : (operations.assertLegacyUnseeded(scratchOutput, pair.task), undefined);
    if (operations.hashRuntime(runtimeSnapshot) !== runtimeSha256) {
      throw new Error("immutable P runtime changed during project-instruction preseed");
    }
    const args = operations.buildArgs(options, pair, mode, scratchOutput, context.remainingSeconds);
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
      label: `run ${pair.run} ${pair.task}/${mode}`,
    });
    const child = await operations.runChild(process.execPath, [operations.resolveRunner(runtimeSnapshot), ...args], {
      cwd: context.repoRoot,
      env: operations.buildEnvironment(options.privateSnapshots),
      stdio: "inherit",
    });
    if (child.error) throw new Error("child benchmark failed to start", { cause: child.error });
    if (child.status !== 0) throw new Error(`child benchmark exited ${child.status ?? "without a status"}`);
    if (operations.hashRuntime(runtimeSnapshot) !== runtimeSha256) {
      throw new Error("immutable P runtime changed during the benchmark cell");
    }
    if (!operations.verifyPrivateInputs(options.privateSnapshots)) {
      throw new Error("ephemeral private benchmark inputs changed during the benchmark cell");
    }
    if (seedMaterialization) operations.verifyMaterialization(seedMaterialization);
    const parsed = operations.readResult(join(scratchOutput, "results.json"));
    capture = { recordingCapture: parsed.recordingCapture, captureOverflow: parsed.captureOverflow };
    const sample = operations.createSample(parsed, { ...context, seedMaterialization });
    livenessFinalized = true;
    liveness = await monitor.finalize(finalizationOptions("process_completed", capture));
    if (liveness.semanticEvidenceAvailable !== true || liveness.semanticEvidenceComplete !== true) {
      throw new Error("child benchmark semantic evidence is incomplete");
    }
    rmSync(recordingPaths.manifestPath, { force: true });
    trustedChildCompletion = true;
    return { ...sample, liveness };
  } catch (error) {
    if (monitor && !livenessFinalized) {
      livenessFinalized = true;
      liveness = await monitor.finalize(finalizationOptions("failed", capture));
    }
    throw liveness ? attachPairedBenchmarkLiveness(error, liveness) : error;
  } finally {
    operations.settleEvidence(
      options.authOutputGuard,
      options.authFiles,
      scratchOutput,
      context.cellOutput,
      trustedChildCompletion,
    );
  }
}
