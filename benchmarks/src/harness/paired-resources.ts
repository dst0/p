import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { BenchmarkAuthOutputGuard } from "./auth-output-guard.ts";
import type { BenchmarkPrivateInputSnapshots } from "./private-input-snapshots.ts";
import { createBenchmarkPrivateInputSnapshots } from "./private-input-snapshots.ts";
import { createRuntimeSnapshot } from "./runtime-snapshot.ts";

export interface PairedBenchmarkResourceOptions {
  repoRoot: string;
  temporaryParent: string;
  modelsSource: string;
  authSource: string;
  model?: string;
}

export interface PairedBenchmarkResourceOperations {
  createRuntime(options: PairedBenchmarkResourceOptions): string;
  createScratch(options: PairedBenchmarkResourceOptions): string;
  createPrivate(options: PairedBenchmarkResourceOptions): BenchmarkPrivateInputSnapshots;
  removeRuntime(path: string): void;
  removeScratch(path: string): void;
}

interface AllocatedPairedResources {
  runtimeSnapshot?: string;
  scratchRoot?: string;
  privateSnapshots?: BenchmarkPrivateInputSnapshots;
}

export interface PairedBenchmarkResources {
  runtimeSnapshot: string;
  scratchRoot: string;
  privateSnapshots: BenchmarkPrivateInputSnapshots;
  dispose(): void;
}

const defaultOperations: PairedBenchmarkResourceOperations = {
  createRuntime: (options) => createRuntimeSnapshot(options.repoRoot, options.temporaryParent),
  createScratch: (options) => realpathSync(mkdtempSync(join(options.temporaryParent, "p-benchmark-cells-"))),
  createPrivate: (options) =>
    createBenchmarkPrivateInputSnapshots(
      options.modelsSource,
      options.authSource,
      options.temporaryParent,
      options.model,
    ),
  removeRuntime: (path) => rmSync(path, { recursive: true, force: true }),
  removeScratch: (path) => rmSync(path, { recursive: true, force: true }),
};

export function createPairedBenchmarkResources(
  options: PairedBenchmarkResourceOptions,
  operationOverrides: Partial<PairedBenchmarkResourceOperations> = {},
): PairedBenchmarkResources {
  const operations = { ...defaultOperations, ...operationOverrides };
  const resources: AllocatedPairedResources = {};
  try {
    resources.runtimeSnapshot = operations.createRuntime(options);
    resources.scratchRoot = operations.createScratch(options);
    resources.privateSnapshots = operations.createPrivate(options);
  } catch (error) {
    const cleanupErrors = disposeResources(resources, operations);
    if (cleanupErrors.length > 0)
      throw new AggregateError([error, ...cleanupErrors], "Paired setup and cleanup failed");
    throw error;
  }
  if (!resources.runtimeSnapshot || !resources.scratchRoot || !resources.privateSnapshots) {
    throw new Error("Paired benchmark resources were not fully allocated");
  }
  return {
    runtimeSnapshot: resources.runtimeSnapshot,
    scratchRoot: resources.scratchRoot,
    privateSnapshots: resources.privateSnapshots,
    dispose: () => {
      const errors = disposeResources(resources, operations);
      if (errors.length > 0) throw new AggregateError(errors, "Paired benchmark resource cleanup failed");
    },
  };
}

export function finalizePairedBenchmarkResources(
  resources: Pick<PairedBenchmarkResources, "dispose">,
  authOutputGuard: BenchmarkAuthOutputGuard | undefined,
  output: string,
  authFiles: readonly string[],
): void {
  const errors: unknown[] = [];
  if (authOutputGuard) {
    for (const path of authFiles) attempt(() => authOutputGuard.capture(path), errors);
    attempt(() => authOutputGuard.sanitizeTree(output), errors);
  }
  attempt(() => resources.dispose(), errors);
  if (errors.length > 0) throw new AggregateError(errors, "Paired benchmark finalization failed");
}

export function settlePairedCellEvidence(
  authOutputGuard: BenchmarkAuthOutputGuard | undefined,
  authFiles: readonly string[],
  source: string,
  destination: string,
  trustedChild: boolean,
): void {
  if (!trustedChild) {
    discardCellEvidence(source, destination);
    return;
  }
  if (!authOutputGuard) {
    discardCellEvidence(source, destination);
    throw new Error("Trusted benchmark child is missing its auth output guard");
  }
  const errors: unknown[] = [];
  for (const path of authFiles) attempt(() => authOutputGuard.capture(path), errors);
  if (errors.length > 0) {
    attempt(() => authOutputGuard.sanitizeTree(source), errors);
    rmSync(destination, { recursive: true, force: true });
    throw new AggregateError(errors, "Paired cell auth recapture failed");
  }
  authOutputGuard.retainTree(source, destination);
}

function discardCellEvidence(source: string, destination: string): void {
  rmSync(source, { recursive: true, force: true });
  rmSync(destination, { recursive: true, force: true });
}

function attempt(action: () => void, errors: unknown[]): void {
  try {
    action();
  } catch (error) {
    errors.push(error);
  }
}

function disposeResources(
  resources: AllocatedPairedResources,
  operations: PairedBenchmarkResourceOperations,
): unknown[] {
  const cleanup: Array<() => void> = [];
  if (resources.privateSnapshots) cleanup.push(() => resources.privateSnapshots?.dispose());
  if (resources.scratchRoot) cleanup.push(() => operations.removeScratch(resources.scratchRoot as string));
  if (resources.runtimeSnapshot) cleanup.push(() => operations.removeRuntime(resources.runtimeSnapshot as string));
  const errors: unknown[] = [];
  for (const dispose of cleanup) {
    try {
      dispose();
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}
