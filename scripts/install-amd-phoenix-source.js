import fs from "node:fs";
import path from "node:path";

import {
  captureCommand,
  findOnPath,
  runCommand,
  runElevated,
} from "./npu-install-utils.js";

export function installPinnedMlirAieSource(runtimeRoot, manifest) {
  if (!findOnPath("git")) {
    runElevated("apt-get", ["update", "-qq"]);
    runElevated("apt-get", ["install", "-y", "git"]);
  }
  const sourceDirectory = path.join(runtimeRoot, "mlir-aie");
  const revision = captureCommand(
    "git",
    ["-C", sourceDirectory, "rev-parse", "HEAD"],
    { allowFailure: true },
  ).trim();
  if (revision === manifest.mlirAieCommit) return sourceDirectory;
  if (fs.existsSync(sourceDirectory)) {
    throw new Error(`Managed MLIR-AIE source has unexpected revision: ${revision || "unknown"}`);
  }
  fs.mkdirSync(runtimeRoot, { mode: 0o700, recursive: true });
  runCommand("git", [
    "clone",
    "--branch",
    `v${manifest.mlirAieVersion}`,
    "--depth",
    "1",
    manifest.mlirAieRepository,
    sourceDirectory,
  ]);
  const installedRevision = captureCommand(
    "git",
    ["-C", sourceDirectory, "rev-parse", "HEAD"],
  ).trim();
  if (installedRevision !== manifest.mlirAieCommit) {
    throw new Error(
      `MLIR-AIE revision mismatch: expected ${manifest.mlirAieCommit}, got ${installedRevision}`,
    );
  }
  return sourceDirectory;
}
