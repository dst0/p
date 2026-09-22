import { rmSync } from "node:fs";
import { join } from "node:path";
import { assertBenchmarkContainment } from "../harness/benchmark-isolation.ts";
import { assertCertifiedOutputWritePath } from "../harness/certified-output-integrity.ts";
import { type BenchmarkEvaluationFreeze, createBenchmarkEvaluationFreeze } from "../harness/evaluation-freeze.ts";
import { benchmarkProjectInstructionProbePath, hashRuntimeSnapshot } from "../harness/runtime-snapshot.ts";
import {
  bindCertifiedHarness,
  bindCertifiedHarnessCore,
  type CertifiedHarnessBinding,
} from "./certification-binding.ts";
import { snapshotCertifiedExecutableRuntime } from "./certification-executable-snapshot.ts";
import type { CertifiedSealedHoldout } from "./certification-holdout.ts";
import { createSealedHoldoutPlan } from "./certification-holdout-plan.ts";
import { snapshotCertifiedModelConfiguration } from "./certification-model-config.ts";
import { createAugmentedProjectInstructions } from "./certification-preflight.ts";
import type { RunnerOptions } from "./runner-options.ts";

export function setupCertifiedBenchmark(
  options: RunnerOptions,
  versions: Record<string, string>,
  repoRoot: string,
  output: string,
): {
  freeze?: BenchmarkEvaluationFreeze;
  binding?: CertifiedHarnessBinding;
  holdout?: CertifiedSealedHoldout;
  receiptValue?: string;
} {
  if (!options.certified) return {};
  const freeze = createBenchmarkEvaluationFreeze(repoRoot);
  let modelConfigurationSnapshot: ReturnType<typeof snapshotCertifiedModelConfiguration> | undefined;
  try {
    modelConfigurationSnapshot = snapshotCertifiedModelConfiguration({
      modelsFile: options.modelsFile,
      kiloConfig: options.kiloConfig,
      model: options.model ?? "",
      kiloModel: options.kiloModel ?? "",
      expectedResolvedModel: options.expectedResolvedModel ?? "",
    });
    options.modelsFile = modelConfigurationSnapshot.modelsFile;
    options.kiloConfig = modelConfigurationSnapshot.kiloConfig;
    options.candidateRuntimePath = freeze.candidateRuntimePath;
    options.pCli = join(freeze.candidateRuntimePath, "packages", "coding-agent", "dist", "cli.js");
    options.projectInstructionProbe = benchmarkProjectInstructionProbePath(freeze.candidateRuntimePath);
    options.piExecutable = snapshotCertifiedExecutableRuntime(
      options.piExecutable,
      "pi",
      join(freeze.candidateRuntimePath, "certified-runtimes", "pi"),
    ).executablePath;
    options.kiloExecutable = snapshotCertifiedExecutableRuntime(
      options.kiloExecutable,
      "kilo",
      join(freeze.candidateRuntimePath, "certified-runtimes", "kilo"),
    ).executablePath;
    freeze.candidateRuntimeSha256 = hashRuntimeSnapshot(freeze.candidateRuntimePath, process.execPath);
    assertBenchmarkContainment(
      { workspace: output, runtime: freeze.candidateRuntimePath },
      { repoRoot, evaluatorPath: freeze.evaluator.path },
    );
    const augmented = createAugmentedProjectInstructions(options.projectInstructionsFile, output);
    options.projectInstructionsFile = augmented.augmentedPath;
    const coreInputs = {
      nodeExecutable: process.execPath,
      pSnapshotPath: freeze.candidateRuntimePath,
      pSnapshotSha256: freeze.candidateRuntimeSha256,
      pVersion: versions.p,
      piExecutable: options.piExecutable,
      piVersion: versions.pi,
      kiloExecutable: options.kiloExecutable,
      kiloVersion: versions.kilo,
      modelConfiguration: modelConfigurationSnapshot.modelConfiguration,
      projectInstructionsFile: augmented.augmentedPath,
      receiptSha256: augmented.receiptSha256,
    };
    const coreBinding = bindCertifiedHarnessCore(coreInputs);
    const holdout = createSealedHoldoutPlan(coreBinding, freeze.evaluator);
    const binding = bindCertifiedHarness({
      ...coreInputs,
      evaluatorPath: freeze.evaluator.path,
      evaluatorSha256: freeze.evaluator.sha256,
      holdoutSha256: holdout.holdoutSha256,
    });
    return {
      freeze: withModelConfigurationCleanup(freeze, modelConfigurationSnapshot),
      binding,
      holdout,
      receiptValue: augmented.receiptValue,
    };
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    try {
      assertCertifiedOutputWritePath(join(output, "instructions"), true);
      rmSync(join(output, "instructions"), { recursive: true, force: true });
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    try {
      modelConfigurationSnapshot?.dispose();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    try {
      freeze.dispose();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError([error, ...cleanupErrors], "Unable to roll back failed certified benchmark setup");
    }
    throw error;
  }
}

function withModelConfigurationCleanup(
  freeze: BenchmarkEvaluationFreeze,
  snapshot: ReturnType<typeof snapshotCertifiedModelConfiguration>,
): BenchmarkEvaluationFreeze {
  return {
    ...freeze,
    dispose: () => {
      const errors: unknown[] = [];
      try {
        snapshot.dispose();
      } catch (error) {
        errors.push(error);
      }
      try {
        freeze.dispose();
      } catch (error) {
        errors.push(error);
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1)
        throw new AggregateError(errors, "Unable to dispose certified model configuration snapshot");
    },
  };
}
