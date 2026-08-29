import type { EphemeralAuthSnapshot } from "./auth-snapshot.ts";
import { createEphemeralAuthSnapshot, verifyEphemeralAuthSnapshot } from "./auth-snapshot.ts";
import type { EphemeralModelsSnapshot } from "./models-snapshot.ts";
import {
  assertBenchmarkModelDefined,
  createEphemeralModelsSnapshot,
  verifyEphemeralModelsSnapshot,
} from "./models-snapshot.ts";
import { sanitizeBenchmarkGitEnvironment } from "./workspace-repository.ts";

export interface BenchmarkPrivateInputSnapshots {
  models: EphemeralModelsSnapshot;
  auth: EphemeralAuthSnapshot;
  dispose(): void;
}

export function createBenchmarkPrivateInputSnapshots(
  modelsSource: string,
  authSource: string,
  temporaryParent?: string,
  requestedModel?: string,
): BenchmarkPrivateInputSnapshots {
  const models = createEphemeralModelsSnapshot(modelsSource, temporaryParent);
  try {
    if (requestedModel) assertBenchmarkModelDefined(models, requestedModel);
    const auth = createEphemeralAuthSnapshot(authSource, temporaryParent);
    return {
      models,
      auth,
      dispose: () => {
        try {
          auth.dispose();
        } finally {
          models.dispose();
        }
      },
    };
  } catch (error) {
    models.dispose();
    throw error;
  }
}

export function verifyBenchmarkPrivateInputSnapshots(snapshots: BenchmarkPrivateInputSnapshots): boolean {
  return verifyEphemeralModelsSnapshot(snapshots.models) && verifyEphemeralAuthSnapshot(snapshots.auth);
}

export function benchmarkPrivateInputEnvironment(
  snapshots: BenchmarkPrivateInputSnapshots,
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return { ...sanitizeBenchmarkGitEnvironment(environment), P_BENCHMARK_AUTH_FILE: snapshots.auth.path };
}

export function benchmarkPrivateInputEvidence(snapshots: BenchmarkPrivateInputSnapshots): {
  modelsFilePresent: boolean;
  modelsFileSha256: string;
} {
  return {
    modelsFilePresent: snapshots.models.present,
    modelsFileSha256: snapshots.models.sha256,
  };
}
