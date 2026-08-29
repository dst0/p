import { closeSync, fsyncSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { BenchmarkRecordingAccounting, BenchmarkRecordingPaths } from "./recording-chunk-store-contract.ts";

export function fsyncRecordingPath(path: string): void {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export function benchmarkRecordingPaths(finalPath: string): BenchmarkRecordingPaths {
  const basePath = finalPath.endsWith(".br") ? finalPath.slice(0, -3) : finalPath;
  return {
    activePath: join(`${basePath}.chunks`, "active.jsonl.active"),
    chunkDirectory: `${basePath}.chunks`,
    compressedTempPath: `${finalPath}.tmp`,
    manifestPath: `${basePath}.manifest.json`,
  };
}

export function benchmarkRecordingManifestPayload(
  accounting: Pick<BenchmarkRecordingAccounting, "bytes" | "sha256">,
): Buffer {
  return Buffer.from(`${JSON.stringify({ schemaVersion: 1, ...accounting })}\n`);
}

export function publishBenchmarkRecordingManifest(manifestPath: string, payload: Buffer): void {
  const tempPath = `${manifestPath}.tmp`;
  let created = false;
  try {
    writeFileSync(tempPath, payload, { flag: "wx", mode: 0o600 });
    created = true;
    fsyncRecordingPath(tempPath);
    renameSync(tempPath, manifestPath);
    fsyncRecordingPath(dirname(manifestPath));
  } catch (error) {
    if (created) rmSync(tempPath, { force: true });
    throw error;
  }
}
