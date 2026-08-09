import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { captureCommand, runCommand } from "./npu-install-utils.js";

export const APPLE_CORE_AI_MANIFEST = Object.freeze({
  artifactVersion: "qwen3-embedding-0.6b-ane-b1-s64-v1",
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

export function installAppleCoreAiRuntime(options) {
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
  console.log("Preparing Qwen Core AI asset for full ANE placement");
  runCommand(venvPython, [
    path.join(options.codeIndexDirectory, "apple_coreai_artifact.py"),
    "--output-root", artifactRoot,
  ]);
  return { artifactRoot, venvPython };
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
