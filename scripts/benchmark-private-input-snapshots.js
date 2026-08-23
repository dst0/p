import { createEphemeralAuthSnapshot, verifyEphemeralAuthSnapshot } from "./benchmark-auth-snapshot.js";
import {
  assertBenchmarkModelDefined,
  createEphemeralModelsSnapshot,
  verifyEphemeralModelsSnapshot,
} from "./benchmark-models-snapshot.js";
import { sanitizeBenchmarkGitEnvironment } from "./benchmark-workspace-repository.js";

export function createBenchmarkPrivateInputSnapshots(modelsSource, authSource, temporaryParent, requestedModel) {
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

export function verifyBenchmarkPrivateInputSnapshots(snapshots) {
  return verifyEphemeralModelsSnapshot(snapshots.models) && verifyEphemeralAuthSnapshot(snapshots.auth);
}

export function benchmarkPrivateInputEnvironment(snapshots, environment = process.env) {
  return { ...sanitizeBenchmarkGitEnvironment(environment), P_BENCHMARK_AUTH_FILE: snapshots.auth.path };
}

export function benchmarkPrivateInputEvidence(snapshots) {
  return {
    modelsFilePresent: snapshots.models.present,
    modelsFileSha256: snapshots.models.sha256,
  };
}
