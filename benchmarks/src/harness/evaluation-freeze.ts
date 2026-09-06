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
): BenchmarkEvaluationFreeze {
  const candidateRuntimePath = createCandidateRuntimeSnapshot(repoRoot, temporaryParent);
  let evaluator: BenchmarkEvaluationSnapshot | undefined;
  try {
    evaluator = createBenchmarkEvaluationSnapshot(repoRoot, temporaryParent);
    const candidateRuntimeSha256 = hashRuntimeSnapshot(candidateRuntimePath, nodeExecutable);
    return {
      candidateRuntimePath,
      candidateRuntimeSha256,
      evaluator,
      dispose: () => {
        evaluator?.dispose();
        rmSync(candidateRuntimePath, { recursive: true, force: true });
      },
    };
  } catch (error) {
    evaluator?.dispose();
    rmSync(candidateRuntimePath, { recursive: true, force: true });
    throw error;
  }
}
