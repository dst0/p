import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { attachBenchmarkCleanupError, isBenchmarkInterruptedError } from "./interruption.ts";
import {
  copyKiloRuntimeEvidence,
  listKiloRuntimeDataEvidence,
  listKiloRuntimeStateEvidence,
} from "./runtime-evidence.ts";

interface StartupEvidence extends Record<string, unknown> {
  status: string;
  error?: string;
  runtimeFiles?: { data: string[]; state: string[] };
}

export function benchmarkStartupProbeFailure(error: unknown, evidence: StartupEvidence, diagnosticsDir: string): Error {
  evidence.status = "failed";
  evidence.error = error instanceof Error ? error.message : String(error);
  return isBenchmarkInterruptedError(error) ? error : new Error(`${evidence.error}; evidence: ${diagnosticsDir}`);
}

export function finalizeKiloStartupEvidence(
  configDir: string,
  diagnosticsDir: string,
  evidence: StartupEvidence,
  primaryError: unknown,
): void {
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

export function finalizeBenchmarkStartupEvidence(
  diagnosticsDir: string,
  evidence: StartupEvidence,
  primaryError: unknown,
): void {
  finalize(() => writeState(diagnosticsDir, evidence), primaryError);
}

function writeState(diagnosticsDir: string, evidence: StartupEvidence): void {
  writeFileSync(join(diagnosticsDir, "state.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

function finalize(action: () => void, primaryError: unknown): void {
  try {
    action();
  } catch (cleanupError) {
    if (isBenchmarkInterruptedError(primaryError)) {
      throw attachBenchmarkCleanupError(primaryError, cleanupError);
    }
    throw cleanupError;
  }
}
