import { chmodSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertSnapshotSymlinksContained,
  copyBenchmarkEvaluatorFixtures,
  createCandidateRuntimeSnapshot,
  hashRuntimeSnapshot,
  hashSnapshotDirectory,
} from "./runtime-snapshot.ts";

export interface BenchmarkEvaluationSnapshot {
  path: string;
  sha256: string;
  dispose(): void;
}

export interface BenchmarkEvaluationFreeze {
  candidateRuntimePath: string;
  candidateRuntimeSha256: string;
  evaluator: BenchmarkEvaluationSnapshot;
  dispose(): void;
}

export interface BenchmarkEvaluationFreezeOperations {
  createCandidate(repoRoot: string, temporaryParent: string): string;
  createEvaluator(repoRoot: string, temporaryParent: string): BenchmarkEvaluationSnapshot;
  hashCandidate(candidatePath: string, nodeExecutable: string): string;
  removeCandidate(candidatePath: string): void;
}

const defaultFreezeOperations: BenchmarkEvaluationFreezeOperations = {
  createCandidate: createCandidateRuntimeSnapshot,
  createEvaluator: createBenchmarkEvaluationSnapshot,
  hashCandidate: hashRuntimeSnapshot,
  removeCandidate: (path) => rmSync(path, { recursive: true, force: true }),
};

export function createBenchmarkEvaluationSnapshot(
  repoRoot: string,
  temporaryParent = tmpdir(),
): BenchmarkEvaluationSnapshot {
  const path = mkdtempSync(join(temporaryParent, "p-benchmark-evaluator-"));
  chmodSync(path, 0o700);
  try {
    copyBenchmarkEvaluatorFixtures(repoRoot, path, { recursive: true, verbatimSymlinks: true });
    assertSnapshotSymlinksContained(path);
    const sha256 = hashSnapshotDirectory(path);
    return { path, sha256, dispose: () => rmSync(path, { recursive: true, force: true }) };
  } catch (error) {
    rmSync(path, { recursive: true, force: true });
    throw error;
  }
}

export function verifyBenchmarkEvaluationSnapshot(snapshot: BenchmarkEvaluationSnapshot): boolean {
  try {
    return existsSync(snapshot.path) && hashSnapshotDirectory(snapshot.path) === snapshot.sha256;
  } catch {
    return false;
  }
}

export function createBenchmarkEvaluationFreeze(
  repoRoot: string,
  temporaryParent = tmpdir(),
  nodeExecutable = process.execPath,
  operations: BenchmarkEvaluationFreezeOperations = defaultFreezeOperations,
): BenchmarkEvaluationFreeze {
  const candidateRuntimePath = operations.createCandidate(repoRoot, temporaryParent);
  let evaluator: BenchmarkEvaluationSnapshot | undefined;
  try {
    evaluator = operations.createEvaluator(repoRoot, temporaryParent);
    const candidateRuntimeSha256 = operations.hashCandidate(candidateRuntimePath, nodeExecutable);
    return {
      candidateRuntimePath,
      candidateRuntimeSha256,
      evaluator,
      dispose: () => disposeEvaluationFreeze(evaluator, candidateRuntimePath),
    };
  } catch (error) {
    const errors = [error];
    try {
      evaluator?.dispose();
    } catch (cleanupError) {
      errors.push(cleanupError);
    }
    try {
      operations.removeCandidate(candidateRuntimePath);
    } catch (cleanupError) {
      errors.push(cleanupError);
    }
    if (errors.length > 1) throw new AggregateError(errors, "Evaluation freeze setup and cleanup failed");
    throw error;
  }
}

function disposeEvaluationFreeze(
  evaluator: BenchmarkEvaluationSnapshot | undefined,
  candidateRuntimePath: string,
): void {
  const errors: unknown[] = [];
  try {
    evaluator?.dispose();
  } catch (error) {
    errors.push(error);
  }
  try {
    rmSync(candidateRuntimePath, { recursive: true, force: true });
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Evaluation freeze cleanup failed");
}
