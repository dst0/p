import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  AMD_RYZEN_AI_MANIFEST,
  installAmdRyzenAiPythonRuntime,
  validateAmdRyzenAiPythonRuntime,
} from "./install-amd-ryzen-ai.js";
import {
  AMD_PHOENIX_IRON_MANIFEST,
  installAmdPhoenixIronPythonRuntime,
  prepareAmdPhoenixQwenArtifact,
  validateAmdPhoenixIronPythonRuntime,
} from "./install-amd-phoenix-iron.js";
import {
  INTEL_OPENVINO_NPU_MANIFEST,
  installIntelOpenVinoPythonRuntime,
  validateIntelOpenVinoPythonRuntime,
} from "./install-intel-openvino-npu.js";
import { captureCommand, runCommand } from "./npu-install-utils.js";

export function getPythonMajorMinor(pythonExecutable, capture = captureCommand) {
  const output = capture(pythonExecutable, [
    "-c",
    "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')",
  ]);
  for (const line of String(output).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = /^(\d+)\.(\d+)$/.exec(trimmed);
    if (match) {
      const major = Number(match[1]);
      const minor = Number(match[2]);
      if (Number.isSafeInteger(major) && Number.isSafeInteger(minor) && major > 0 && minor >= 0) {
        return [major, minor];
      }
    }
  }
  return undefined;
}

function hasSymlinkedParent(targetPath) {
  let current = path.dirname(path.resolve(targetPath));
  while (current && current !== path.dirname(current)) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) return true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    current = path.dirname(current);
  }
  return false;
}

export function reconcilePythonVenv(options, capture = captureCommand) {
  if (!options?.agentDirectory || typeof options.agentDirectory !== "string") {
    throw new Error("reconcilePythonVenv requires options.agentDirectory");
  }
  if (!options?.python || typeof options.python !== "string") {
    throw new Error("reconcilePythonVenv requires options.python");
  }
  const normalizedAgentDir = path.normalize(path.resolve(options.agentDirectory));
  const expectedVenvDir = path.normalize(path.join(normalizedAgentDir, "indexing-service", "venv"));
  const expectedVenvPython = path.normalize(path.join(expectedVenvDir, "bin", "python"));

  if (options.venvDirectory && path.normalize(path.resolve(options.venvDirectory)) !== expectedVenvDir) {
    throw new Error(`reconcilePythonVenv options.venvDirectory must be exactly ${expectedVenvDir}`);
  }
  if (options.venvPython && path.normalize(path.resolve(options.venvPython)) !== expectedVenvPython) {
    throw new Error(`reconcilePythonVenv options.venvPython must be exactly ${expectedVenvPython}`);
  }

  if (hasSymlinkedParent(expectedVenvDir)) {
    throw new Error(`Managed venv parent directory contains a symlink: ${expectedVenvDir}`);
  }

  const selectedVersion = getPythonMajorMinor(options.python, capture);
  if (!selectedVersion) {
    throw new Error(`Failed to determine Python version for selected interpreter: ${options.python}`);
  }

  let stat;
  try {
    stat = fs.lstatSync(expectedVenvDir);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }

  if (stat.isSymbolicLink()) {
    fs.unlinkSync(expectedVenvDir);
    return false;
  }

  if (!stat.isDirectory()) {
    fs.rmSync(expectedVenvDir, { recursive: true, force: true });
    return false;
  }

  let venvVersion;
  if (fs.existsSync(expectedVenvPython)) {
    try {
      venvVersion = getPythonMajorMinor(expectedVenvPython, capture);
    } catch {
      venvVersion = undefined;
    }
  }
  if (!venvVersion || venvVersion[0] !== selectedVersion[0] || venvVersion[1] !== selectedVersion[1]) {
    fs.rmSync(expectedVenvDir, { recursive: true, force: true });
    return false;
  }
  return true;
}

export function installPythonEnvironment(options) {
  reconcilePythonVenv(options);
  const normalizedAgentDir = path.normalize(path.resolve(options.agentDirectory));
  const venvDirectory = path.normalize(path.join(normalizedAgentDir, "indexing-service", "venv"));
  const venvPython = path.normalize(path.join(venvDirectory, "bin", "python"));
  const requirements = fs.readFileSync(options.requirementsPath, "utf-8");
  const markerPath = path.join(venvDirectory, ".p-requirements");
  const marker = createHash("sha256")
    .update(
      `${options.python}\0${captureCommand(options.python, ["--version"])}\0${requirements}`
      + `\0${JSON.stringify(options.torchPlan)}`
      + `\0${options.installAmdPhoenixIron ? JSON.stringify(AMD_PHOENIX_IRON_MANIFEST) : "generic"}`
      + `\0${options.installAmdRyzenAi ? JSON.stringify(AMD_RYZEN_AI_MANIFEST) : "generic"}`
      + `\0${options.ryzenAiArchivePath ?? "auto-archive-discovery"}`
      + `\0${options.installIntelOpenVino ? JSON.stringify(INTEL_OPENVINO_NPU_MANIFEST) : "generic"}`,
    )
    .digest("hex");
  if (fs.existsSync(venvPython) && readFileIfPresent(markerPath) === marker) {
    validateSelectedRuntimes({ ...options, venvDirectory, venvPython });
    validateTorchInstallation(venvPython, options.torchPlan, {
      requireAccelerator: options.requireTorchAccelerator,
    });
    return;
  }
  console.log(`Installing pinned code-index Python dependencies for ${options.torchPlan.backend}`);
  runCommand(options.python, ["-m", "venv", venvDirectory]);
  if (options.torchPlan.indexUrl) {
    runCommand(venvPython, [
      "-m", "pip", "install", "--disable-pip-version-check", "--only-binary=:all:",
      "--force-reinstall", `torch==${options.torchPlan.version}`, "--index-url", options.torchPlan.indexUrl,
    ]);
  }
  runCommand(venvPython, [
    "-m", "pip", "install", "--disable-pip-version-check", "--only-binary=:all:",
    "--requirement", options.requirementsPath,
  ]);
  if (options.installAmdRyzenAi) {
    installAmdRyzenAiPythonRuntime(venvPython, {
      agentDirectory: options.agentDirectory,
      archivePath: options.ryzenAiArchivePath,
    });
  }
  if (options.installAmdPhoenixIron) {
    installAmdPhoenixIronPythonRuntime(venvPython, {
      agentDirectory: options.agentDirectory,
    });
  }
  if (options.installIntelOpenVino) installIntelOpenVinoPythonRuntime(venvPython);
  validateTorchInstallation(venvPython, options.torchPlan, {
    requireAccelerator: options.requireTorchAccelerator,
  });
  fs.writeFileSync(markerPath, marker, { mode: 0o600 });
}

export function validateTorchInstallation(venvPython, torchPlan, options = {}) {
  const probe = JSON.parse(captureCommand(venvPython, ["-c", [
    "import json, torch",
    "mps = getattr(torch.backends, 'mps', None)",
    "print(json.dumps({'version': torch.__version__, 'cuda': getattr(torch.version, 'cuda', None),",
    "'hip': getattr(torch.version, 'hip', None),",
    "'accelerator_available': bool(torch.cuda.is_available() or (mps and mps.is_available()))}))",
  ].join("\n")]));
  if (!String(probe.version).startsWith(torchPlan.version)) {
    throw new Error(`Expected PyTorch ${torchPlan.version}, installed ${probe.version}`);
  }
  if (torchPlan.backend === "rocm" && !probe.hip) throw new Error("The installed PyTorch build lacks ROCm/HIP");
  if (torchPlan.backend === "cuda" && !probe.cuda) throw new Error("The installed PyTorch build lacks CUDA");
  if (torchPlan.backend === "cpu" && (probe.hip || probe.cuda)) throw new Error("PyTorch is not CPU-only");
  if (options.requireAccelerator && !probe.accelerator_available) {
    throw new Error(`The installed PyTorch ${torchPlan.backend} accelerator is unavailable`);
  }
  console.log(
    `PyTorch ${probe.version} installed (${torchPlan.backend}); accelerator currently `
    + `${probe.accelerator_available ? "available" : "unavailable"}`,
  );
}

function validateSelectedRuntimes(options) {
  if (options.installAmdPhoenixIron) {
    validateAmdPhoenixIronPythonRuntime(options.venvPython);
    prepareAmdPhoenixQwenArtifact(options.venvPython, {
      agentDirectory: options.agentDirectory,
    });
  }
  if (options.installAmdRyzenAi) validateAmdRyzenAiPythonRuntime(options.venvPython);
  if (options.installIntelOpenVino) validateIntelOpenVinoPythonRuntime(options.venvPython);
}

function readFileIfPresent(filePath) {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return undefined;
  }
}
