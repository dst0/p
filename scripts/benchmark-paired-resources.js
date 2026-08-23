import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createBenchmarkPrivateInputSnapshots } from "./benchmark-private-input-snapshots.js";
import { createRuntimeSnapshot } from "./benchmark-runtime-snapshot.js";

const defaultOperations = {
  createRuntime: (options) => createRuntimeSnapshot(options.repoRoot, options.temporaryParent),
  createScratch: (options) => realpathSync(mkdtempSync(join(options.temporaryParent, "p-benchmark-cells-"))),
  createPrivate: (options) =>
    createBenchmarkPrivateInputSnapshots(options.modelsSource, options.authSource, options.temporaryParent, options.model),
  removeRuntime: (path) => rmSync(path, { recursive: true, force: true }),
  removeScratch: (path) => rmSync(path, { recursive: true, force: true }),
};

export function createPairedBenchmarkResources(options, operationOverrides = {}) {
  const operations = { ...defaultOperations, ...operationOverrides };
  const resources = {};
  try {
    resources.runtimeSnapshot = operations.createRuntime(options);
    resources.scratchRoot = operations.createScratch(options);
    resources.privateSnapshots = operations.createPrivate(options);
  } catch (error) {
    const cleanupErrors = disposeResources(resources, operations);
    if (cleanupErrors.length > 0) throw new AggregateError([error, ...cleanupErrors], "Paired setup and cleanup failed");
    throw error;
  }
  return {
    ...resources,
    dispose: () => {
      const errors = disposeResources(resources, operations);
      if (errors.length > 0) throw new AggregateError(errors, "Paired benchmark resource cleanup failed");
    },
  };
}

export function finalizePairedBenchmarkResources(resources, authOutputGuard, output, authFiles) {
  const errors = [];
  if (authOutputGuard) {
    for (const path of authFiles) attempt(() => authOutputGuard.capture(path), errors);
    attempt(() => authOutputGuard.sanitizeTree(output), errors);
  }
  attempt(() => resources.dispose(), errors);
  if (errors.length > 0) throw new AggregateError(errors, "Paired benchmark finalization failed");
}

export function settlePairedCellEvidence(authOutputGuard, authFiles, source, destination, trustedChild) {
  if (!trustedChild) {
    discardCellEvidence(source, destination);
    return;
  }
  if (!authOutputGuard) {
    discardCellEvidence(source, destination);
    throw new Error("Trusted benchmark child is missing its auth output guard");
  }
  const errors = [];
  for (const path of authFiles) attempt(() => authOutputGuard.capture(path), errors);
  if (errors.length > 0) {
    attempt(() => authOutputGuard.sanitizeTree(source), errors);
    rmSync(destination, { recursive: true, force: true });
    throw new AggregateError(errors, "Paired cell auth recapture failed");
  }
  authOutputGuard.retainTree(source, destination);
}

function discardCellEvidence(source, destination) {
  rmSync(source, { recursive: true, force: true });
  rmSync(destination, { recursive: true, force: true });
}

function attempt(action, errors) {
  try {
    action();
  } catch (error) {
    errors.push(error);
  }
}

function disposeResources(resources, operations) {
  const cleanup = [
    resources.privateSnapshots && (() => resources.privateSnapshots.dispose()),
    resources.scratchRoot && (() => operations.removeScratch(resources.scratchRoot)),
    resources.runtimeSnapshot && (() => operations.removeRuntime(resources.runtimeSnapshot)),
  ].filter(Boolean);
  const errors = [];
  for (const dispose of cleanup) {
    try {
      dispose();
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}
