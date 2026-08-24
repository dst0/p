import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { attachBenchmarkCleanupError, isBenchmarkInterruptedError } from "./benchmark-interruption.js";
import {
  copyKiloRuntimeEvidence,
  listKiloRuntimeDataEvidence,
  listKiloRuntimeStateEvidence,
} from "./benchmark-runtime-evidence.js";

export function benchmarkStartupProbeFailure(error, evidence, diagnosticsDir) {
  evidence.status = "failed";
  evidence.error = error instanceof Error ? error.message : String(error);
  return isBenchmarkInterruptedError(error)
    ? error
    : new Error(`${evidence.error}; evidence: ${diagnosticsDir}`);
}

export function finalizeKiloStartupEvidence(configDir, diagnosticsDir, evidence, primaryError) {
  finalize(() => {
    const dataRoot = join(configDir, "data");
    const stateRoot = join(configDir, "state");
    evidence.runtimeFiles = {
      data: listKiloRuntimeDataEvidence(dataRoot),
      state: listKiloRuntimeStateEvidence(stateRoot),
    };
    copyKiloRuntimeEvidence(dataRoot, stateRoot, diagnosticsDir);
    writeState(diagnosticsDir, evidence);
  }, primaryError);
}

export function finalizeBenchmarkStartupEvidence(diagnosticsDir, evidence, primaryError) {
  finalize(() => writeState(diagnosticsDir, evidence), primaryError);
}

function writeState(diagnosticsDir, evidence) {
  writeFileSync(join(diagnosticsDir, "state.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

function finalize(action, primaryError) {
  try {
    action();
  } catch (cleanupError) {
    if (isBenchmarkInterruptedError(primaryError)) {
      throw attachBenchmarkCleanupError(primaryError, cleanupError);
    }
    throw cleanupError;
  }
}
