import { createHash } from "node:crypto";
import fs from "node:fs";

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

export function installPythonEnvironment(options) {
  const requirements = fs.readFileSync(options.requirementsPath, "utf-8");
  const markerPath = `${options.venvDirectory}/.p-requirements`;
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
  if (fs.existsSync(options.venvPython) && readFileIfPresent(markerPath) === marker) {
    validateSelectedRuntimes(options);
    validateTorchInstallation(options.venvPython, options.torchPlan, {
      requireAccelerator: options.requireTorchAccelerator,
    });
    return;
  }
  console.log(`Installing pinned code-index Python dependencies for ${options.torchPlan.backend}`);
  runCommand(options.python, ["-m", "venv", options.venvDirectory]);
  if (options.torchPlan.indexUrl) {
    runCommand(options.venvPython, [
      "-m", "pip", "install", "--disable-pip-version-check", "--only-binary=:all:",
      "--force-reinstall", `torch==${options.torchPlan.version}`, "--index-url", options.torchPlan.indexUrl,
    ]);
  }
  runCommand(options.venvPython, [
    "-m", "pip", "install", "--disable-pip-version-check", "--only-binary=:all:",
    "--requirement", options.requirementsPath,
  ]);
  if (options.installAmdRyzenAi) {
    installAmdRyzenAiPythonRuntime(options.venvPython, {
      agentDirectory: options.agentDirectory,
      archivePath: options.ryzenAiArchivePath,
    });
  }
  if (options.installAmdPhoenixIron) {
    installAmdPhoenixIronPythonRuntime(options.venvPython, {
      agentDirectory: options.agentDirectory,
    });
  }
  if (options.installIntelOpenVino) installIntelOpenVinoPythonRuntime(options.venvPython);
  validateTorchInstallation(options.venvPython, options.torchPlan, {
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
