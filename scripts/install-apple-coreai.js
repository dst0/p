import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  CANONICAL_COREAI_ARTIFACT_VERSION,
  validateArtifactRoot,
  validateGenerationPath,
} from "./apple-coreai-generation-path.js";
import { runBoundedProcessCommand, sanitizeDiagnostics } from "./bounded-process-command.js";
import { captureCommand, runCommand } from "./npu-install-utils.js";

export { validateArtifactRoot, validateGenerationPath };

export const APPLE_CORE_AI_MANIFEST = Object.freeze({
  artifactVersion: CANONICAL_COREAI_ARTIFACT_VERSION,
  coreAiCoreVersion: "1.0.0b2",
  coreAiModelsCommit: "16777134f3d6df44abffa142d04c2284f83d6b53",
  coreAiModelsSha256: "c2b5051d6687f373e252ced98ef0f072f9f1405718a44cf083368f1d6ced90b2",
  minimumMacOsMajor: 27,
});

export function isMacOsCoreAiAvailable(options = {}) {
  const platform = options.platform ?? process.platform;
  const architecture = options.architecture ?? process.arch;
  if (platform !== "darwin" || architecture !== "arm64") return false;
  const version = options.macOsVersion ?? captureCommand("sw_vers", ["-productVersion"], {
    allowFailure: true,
  }).trim();
  const major = Number(String(version).split(".", 1)[0]);
  return Number.isInteger(major) && major >= APPLE_CORE_AI_MANIFEST.minimumMacOsMajor;
}

export function validateCoreAiProbeHealth(probe) {
  if (!probe || typeof probe !== "object") {
    throw new Error("Core AI worker probe failed: payload is not an object");
  }
  if (probe.status !== "ready") {
    throw new Error(`Core AI worker probe failed: status is "${probe.status}", expected "ready"`);
  }
  if (probe.npuFullyPlaced !== true) {
    throw new Error(`Core AI worker probe failed: npuFullyPlaced is ${probe.npuFullyPlaced}, expected true`);
  }
  if (probe.gpuActivity !== false) {
    throw new Error(`Core AI worker probe failed: gpuActivity is ${probe.gpuActivity}, expected false`);
  }
  if (probe.preferredComputeUnit !== "Neural Engine") {
    throw new Error(
      `Core AI worker probe failed: preferredComputeUnit is "${probe.preferredComputeUnit}", expected "Neural Engine"`,
    );
  }
}

export async function buildAppleCoreAiCandidate(python, codeIndexDirectory, artifactRoot, generation) {
  const artifactDirectory = validateGenerationPath(artifactRoot, generation);
  const result = await runBoundedProcessCommand(
    python,
    [path.join(codeIndexDirectory, "apple_coreai_artifact.py"), "--output-root", artifactRoot, "--generation", generation],
    { env: { ...process.env, USE_OS_COREAI: "1" }, timeout: 600000 },
  );
  if (result.status !== 0) {
    const raw = (result.stderr ?? "").trim() || (result.stdout ?? "").trim() || `process exited with code ${result.status}`;
    throw new Error(`Core AI candidate build failed: ${sanitizeDiagnostics(raw)}`);
  }
  return { artifactDirectory, generation };
}

export async function probeAppleCoreAiWorker(python, codeIndexDirectory, target, options = {}) {
  const timeout = options.timeout ?? 600000;
  const args = [path.join(codeIndexDirectory, "apple_coreai_worker.py")];
  if (typeof target === "string") args.push("--artifact-root", target);
  else if (target?.artifactDirectory) args.push("--artifact-directory", target.artifactDirectory);
  else if (target?.artifactRoot) args.push("--artifact-root", target.artifactRoot);
  else throw new Error("probeAppleCoreAiWorker requires artifactRoot or artifactDirectory target");
  args.push("--probe");

  const result = await runBoundedProcessCommand(python, args, {
    env: { ...process.env, USE_OS_COREAI: "1" },
    timeout,
  });
  if (result.status !== 0) {
    const raw = (result.stderr ?? "").trim() || (result.stdout ?? "").trim() || `process exited with code ${result.status}`;
    throw new Error(`Core AI worker probe process failed: ${sanitizeDiagnostics(raw)}`);
  }
  let probe;
  try {
    probe = JSON.parse(result.stdout.trim());
  } catch (error) {
    const diag = sanitizeDiagnostics(error instanceof Error ? error.message : String(error));
    throw new Error(`Invalid Core AI worker probe output: invalid JSON (${diag})`);
  }
  validateCoreAiProbeHealth(probe);
  return probe;
}

export function promoteCurrentPointerAtomic(artifactRoot, generation) {
  const targetDir = validateGenerationPath(artifactRoot, generation);
  let targetStat;
  try {
    targetStat = fs.lstatSync(targetDir);
  } catch (statError) {
    throw new Error(`Target generation does not exist: ${targetDir} (${statError.message})`);
  }
  if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
    throw new Error(`Target generation must be a non-symlink directory: ${targetDir}`);
  }

  const metadataPath = path.join(targetDir, "artifact.json");
  let metaStat;
  try {
    metaStat = fs.lstatSync(metadataPath);
  } catch (statError) {
    throw new Error(`Artifact metadata file missing: ${metadataPath} (${statError.message})`);
  }
  if (metaStat.isSymbolicLink() || !metaStat.isFile()) {
    throw new Error(`Artifact metadata file must be a non-symlink file: ${metadataPath}`);
  }
  let metadata;
  try {
    metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  } catch (parseError) {
    throw new Error(`Failed to parse artifact metadata from ${metadataPath}: ${parseError.message}`);
  }
  if (!metadata || typeof metadata !== "object") {
    throw new Error(`Invalid artifact metadata in ${metadataPath}: root must be an object`);
  }
  if (metadata.artifactVersion !== APPLE_CORE_AI_MANIFEST.artifactVersion) {
    throw new Error(
      `Artifact version mismatch in metadata: expected "${APPLE_CORE_AI_MANIFEST.artifactVersion}", got "${metadata.artifactVersion}"`,
    );
  }
  if (metadata.model !== "Qwen/Qwen3-Embedding-0.6B") {
    throw new Error(`Artifact model mismatch in metadata: expected "Qwen/Qwen3-Embedding-0.6B", got "${metadata.model}"`);
  }
  if (typeof metadata.batchSize !== "number" || metadata.batchSize !== 1) {
    throw new Error(`Artifact metadata batchSize must be number 1, got ${metadata.batchSize}`);
  }
  if (typeof metadata.sequenceLength !== "number" || metadata.sequenceLength !== 64) {
    throw new Error(`Artifact metadata sequenceLength must be number 64, got ${metadata.sequenceLength}`);
  }

  const pointerPayload = `${JSON.stringify({
    artifactDirectory: generation,
    artifactVersion: APPLE_CORE_AI_MANIFEST.artifactVersion,
  }, null, 2)}\n`;
  const tempPath = path.join(artifactRoot, `current.json.${randomUUID()}.tmp`);
  const currentPath = path.join(artifactRoot, "current.json");

  try {
    const fd = fs.openSync(tempPath, "wx", 0o600);
    try {
      fs.writeFileSync(fd, pointerPayload, "utf8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tempPath, currentPath);
  } catch (writeOrRenameError) {
    try {
      if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
    } catch {}
    throw writeOrRenameError;
  }

  try {
    const dirFd = fs.openSync(artifactRoot, "r");
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch (dirFsyncError) {
    const code = dirFsyncError && dirFsyncError.code;
    if (code === "EINVAL" || code === "ENOTSUP" || code === "EISDIR" || code === "ENOSYS") return;
    const error = new Error(`Directory fsync failed after pointer rename: ${dirFsyncError.message}`);
    error.code = code;
    throw error;
  }
}

export async function ensureAppleCoreAiArtifact(options) {
  const {
    artifactRoot,
    codeIndexDirectory,
    venvPython,
    buildCandidate = buildAppleCoreAiCandidate,
    probeWorker = probeAppleCoreAiWorker,
  } = options;

  validateArtifactRoot(artifactRoot);
  fs.mkdirSync(artifactRoot, { recursive: true });
  const currentPointerPath = path.join(artifactRoot, "current.json");

  if (fs.existsSync(currentPointerPath)) {
    try {
      await probeWorker(venvPython, codeIndexDirectory, { artifactRoot });
      return { artifactRoot, venvPython };
    } catch (initialError) {
      const diag = sanitizeDiagnostics(
        initialError instanceof Error ? initialError.message : String(initialError),
      );
      console.warn(`Core AI current artifact probe failed: ${diag}; building fresh candidate generation`);
    }
  }

  const generation = `${APPLE_CORE_AI_MANIFEST.artifactVersion}-${randomUUID()}`;
  const candidateDir = path.join(artifactRoot, generation);
  console.log(`Preparing Core AI candidate generation ${generation}`);

  await buildCandidate(venvPython, codeIndexDirectory, artifactRoot, generation);

  try {
    await probeWorker(venvPython, codeIndexDirectory, { artifactDirectory: candidateDir });
  } catch (probeError) {
    if (fs.existsSync(candidateDir)) {
      fs.rmSync(candidateDir, { force: true, recursive: true });
    }
    throw probeError;
  }

  promoteCurrentPointerAtomic(artifactRoot, generation);
  return { artifactRoot, venvPython };
}

export async function installAppleCoreAiRuntime(options) {
  const serviceRoot = path.join(options.agentDirectory, "indexing-service");
  const venvDirectory = path.join(serviceRoot, "coreai-venv");
  const venvPython = path.join(venvDirectory, "bin", "python");
  const artifactRoot = path.join(serviceRoot, "apple-coreai");
  const requirementsPath = path.join(options.codeIndexDirectory, "requirements-coreai.txt");
  const requirements = fs.readFileSync(requirementsPath, "utf8");
  const markerPath = path.join(venvDirectory, ".p-coreai-requirements");
  const marker = createHash("sha256")
    .update(`${captureCommand(options.python, ["--version"])}\0${requirements}`)
    .update(`\0${JSON.stringify(APPLE_CORE_AI_MANIFEST)}`)
    .digest("hex");
  if (!fs.existsSync(venvPython) || readFileIfPresent(markerPath) !== marker) {
    console.log("Installing pinned macOS Core AI runtime for Apple Neural Engine indexing");
    runCommand(options.python, ["-m", "venv", venvDirectory]);
    runCommand(venvPython, [
      "-m", "pip", "install", "--disable-pip-version-check", "--only-binary=:all:",
      "--requirement", requirementsPath,
    ]);
    runCommand(venvPython, [
      "-m", "pip", "install", "--disable-pip-version-check", "--no-deps",
      `https://github.com/apple/coreai-models/archive/${APPLE_CORE_AI_MANIFEST.coreAiModelsCommit}.tar.gz`
        + `#sha256=${APPLE_CORE_AI_MANIFEST.coreAiModelsSha256}&subdirectory=python`,
    ]);
    validateAppleCoreAiRuntime(venvPython);
    fs.writeFileSync(markerPath, marker, { mode: 0o600 });
  } else {
    validateAppleCoreAiRuntime(venvPython);
  }
  return await ensureAppleCoreAiArtifact({
    artifactRoot,
    codeIndexDirectory: options.codeIndexDirectory,
    venvPython,
  });
}

export function validateAppleCoreAiRuntime(python) {
  const probe = JSON.parse(captureCommand(python, ["-c", [
    "import json",
    "from coreai.runtime import ComputeUnitKind, SpecializationOptions",
    "kinds = [str(kind) for kind in ComputeUnitKind.available_kinds()]",
    "print(json.dumps({'supported': SpecializationOptions.is_supported(), 'kinds': kinds}))",
  ].join("\n")], { env: { ...process.env, USE_OS_COREAI: "1" } }));
  if (!probe.supported || !probe.kinds.includes("Neural Engine")) {
    throw new Error(`Core AI does not expose the Apple Neural Engine: ${JSON.stringify(probe)}`);
  }
}

function readFileIfPresent(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}
