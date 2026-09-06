import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "../config.ts";

export function computeIndexingVersion(projectRoot?: string): string {
  const root = projectRoot ?? resolveProjectRoot();
  const hash = createHash("sha256");
  for (const filePath of collectIndexingFiles(root).sort()) {
    try {
      hash.update(path.relative(root, filePath));
      hash.update(fs.readFileSync(filePath));
    } catch {
      // A file may disappear during concurrent installation.
    }
  }
  return hash.digest("hex");
}

function collectIndexingFiles(projectRoot: string): string[] {
  const files: string[] = [];
  const agentRoot = path.join(projectRoot, "packages", "coding-agent");
  const codeIndexDir = path.join(projectRoot, "packages", "code-index");
  const daemon = path.join(agentRoot, "dist", "indexing-service-daemon.js");
  if (isFile(daemon)) files.push(daemon);

  const distCore = path.join(agentRoot, "dist", "core");
  const sourceCore = path.join(agentRoot, "src", "core");
  const runtimeCore = isDirectory(distCore) ? distCore : sourceCore;
  collectFlatFiles(runtimeCore, files, (name) => {
    return name.startsWith("indexing") && (name.endsWith(".js") || name.endsWith(".ts"));
  });
  const indexingDaemon = path.join(runtimeCore, "indexing-daemon");
  if (isDirectory(indexingDaemon)) collectRecursiveFiles(indexingDaemon, files, [".js", ".ts"]);

  const installerNames = [
    "apple-coreai-generation-path.js",
    "bounded-process-command.js",
    "build-indexing-tray.js",
    "compute-indexing-version.js",
    "compute-indexing-runtime-fingerprint.js",
    "indexing-device-detection.sh",
    "indexing-device-selection.sh",
    "indexing-install-fallback.js",
    "indexing-install-plans.js",
    "indexing-reinstall-lock.js",
    "indexing-reinstall-transaction.sh",
    "indexing-python-discovery.js",
    "indexing-python-environment.js",
    "indexing-qdrant-assets.js",
    "indexing-service-reuse.js",
    "indexing-service-health.js",
    "install-apple-coreai.js",
    "install-amd-ryzen-ai.js",
    "install-amd-xdna-driver.js",
    "install-indexing-service.js",
    "install-intel-npu-driver.js",
    "install-intel-openvino-npu.js",
    "npu-install-utils.js",
    "prepare-indexing-service-reinstall.js",
  ];
  for (const name of installerNames) {
    const filePath = path.join(projectRoot, "scripts", name);
    if (isFile(filePath)) files.push(filePath);
  }

  const trayDir = path.join(agentRoot, "src", "tray");
  if (isDirectory(trayDir)) collectRecursiveFiles(trayDir, files, [".swift", ".sh"]);

  const codeIndexDist = path.join(codeIndexDir, "dist");
  if (isDirectory(codeIndexDist)) collectRecursiveFiles(codeIndexDist, files, [".js"]);
  collectFlatFiles(codeIndexDir, files, (name) => name.endsWith(".py"));

  const pythonPackage = path.join(codeIndexDir, "src", "code-index");
  if (isDirectory(pythonPackage)) collectRecursiveFiles(pythonPackage, files, [".py"]);
  const backends = path.join(codeIndexDir, "embedding_backends");
  if (isDirectory(backends)) collectRecursiveFiles(backends, files, [".py"]);
  const swiftWorker = path.join(codeIndexDir, "apple-ane-worker", "Sources");
  if (isDirectory(swiftWorker)) collectRecursiveFiles(swiftWorker, files, [".swift"]);

  for (const name of ["requirements.txt", "requirements-coreai.txt", "pyproject.toml"]) {
    const filePath = path.join(codeIndexDir, name);
    if (isFile(filePath)) files.push(filePath);
  }
  return files;
}

function collectFlatFiles(dir: string, result: string[], filter: (name: string) => boolean): void {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && filter(entry.name)) result.push(path.join(dir, entry.name));
    }
  } catch {
    // Optional build/source directory.
  }
}

function collectRecursiveFiles(dir: string, result: string[], extensions: string[]): void {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) collectRecursiveFiles(fullPath, result, extensions);
      else if (extensions.some((extension) => entry.name.endsWith(extension))) result.push(fullPath);
    }
  } catch {
    // Optional build/source directory.
  }
}

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isDirectory(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function resolveProjectRoot(): string {
  let current = path.dirname(fileURLToPath(import.meta.url));
  for (let index = 0; index < 10; index++) {
    if (fs.existsSync(path.join(current, "packages", "coding-agent"))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.dirname(path.dirname(path.dirname(getAgentDir())));
}
