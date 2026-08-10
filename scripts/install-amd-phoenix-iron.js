#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  captureCommand,
  compareVersions,
  findOnPath,
  normalizeHex,
  parseKernelVersion,
  parseOsRelease,
  readTrimmedFile,
  runCommand,
} from "./npu-install-utils.js";
import {
  ensureAmdNpuAccess,
  installAmdXdnaPpaRuntime,
  installUbuntuHweKernel,
} from "./install-amd-xdna-driver.js";
import { installPinnedMlirAieSource } from "./install-amd-phoenix-source.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PHOENIX_PROBE = path.join(
  SCRIPT_DIR,
  "..",
  "packages",
  "code-index",
  "amd_phoenix_iron_probe.py",
);
const PHOENIX_QWEN_ARTIFACT = path.join(
  SCRIPT_DIR,
  "..",
  "packages",
  "code-index",
  "amd_phoenix_qwen_artifact.py",
);
const XRT_ROOT = "/opt/xilinx/xrt";
const XRT_SMI = path.join(XRT_ROOT, "bin", "xrt-smi");

export const AMD_PHOENIX_IRON_MANIFEST = Object.freeze({
  backendId: "amd-phoenix-npu",
  deviceGeneration: "npu1",
  mlirAieVersion: "1.4.0",
  mlirAieCommit: "db06374df9bf83d9fc557001ca213368aed15788",
  mlirAieWheelIndex: "https://github.com/Xilinx/mlir-aie/releases/expanded_assets/v1.4.0",
  mlirAieRepository: "https://github.com/Xilinx/mlir-aie.git",
  peanoVersion: "21.0.0.2026072001+ce8c0f8f",
  peanoWheelIndex: "https://github.com/Xilinx/llvm-aie/releases/expanded_assets/nightly",
  systemPackages: Object.freeze({
    "amdxdna-dkms": "7.0.0-rc1+git20260310.6b13cb8f4-noble1",
    "libxrt-dev": "1:2.21.75-1~noble1",
    "libxrt-npu2": "1:2.21.75-1~noble1",
    "libxrt-utils": "1:2.21.75-1~noble1",
    "libxrt-utils-npu": "1:2.21.75-1~noble1",
    "libxrt2": "1:2.21.75-1~noble1",
  }),
  pythonVersion: "3.12",
  minimumKernel: Object.freeze([6, 17, 0]),
  supportedPciDevice: "0x1502",
  supportedOs: Object.freeze({ id: "ubuntu", versionId: "24.04" }),
  sequenceLengths: Object.freeze([512, 1024, 2048]),
});

export function resolveAmdPhoenixIronPlatform(options) {
  const platform = options.platform ?? process.platform;
  const architecture = options.architecture ?? process.arch;
  if (platform !== "linux" || architecture !== "x64") {
    throw new Error(`AMD Phoenix IRON indexing requires Linux x64, found ${platform}/${architecture}`);
  }
  const osRelease = options.osRelease ?? {};
  if (
    osRelease.ID !== AMD_PHOENIX_IRON_MANIFEST.supportedOs.id
    || osRelease.VERSION_ID !== AMD_PHOENIX_IRON_MANIFEST.supportedOs.versionId
  ) {
    throw new Error(
      `AMD Phoenix IRON requires Ubuntu 24.04; found ${osRelease.ID ?? "unknown"} ${osRelease.VERSION_ID ?? "unknown"}`,
    );
  }
  const pciDevice = (options.pciDevices ?? []).find(
    (device) => normalizeHex(device.vendor, 4) === "0x1022"
      && normalizeHex(device.device, 4) === AMD_PHOENIX_IRON_MANIFEST.supportedPciDevice,
  );
  if (!pciDevice) throw new Error("No AMD Phoenix/Hawk Point XDNA NPU PCI device was detected");
  const kernelVersion = parseKernelVersion(options.kernelRelease ?? os.release());
  return {
    apuType: "PHX/HPT",
    backendId: AMD_PHOENIX_IRON_MANIFEST.backendId,
    deviceGeneration: AMD_PHOENIX_IRON_MANIFEST.deviceGeneration,
    kernelVersion,
    pciDevice,
    requiresKernelUpgrade: compareVersions(kernelVersion, AMD_PHOENIX_IRON_MANIFEST.minimumKernel) < 0,
    supported: true,
  };
}

export function inspectAmdPhoenixIronPlatform(options = {}) {
  const osReleasePath = options.osReleasePath ?? "/etc/os-release";
  const sysfsRoot = options.sysfsRoot ?? "/sys/bus/pci/devices";
  const pciDevices = options.pciDevices ?? detectPhoenixDevices(sysfsRoot);
  return resolveAmdPhoenixIronPlatform({
    architecture: options.architecture,
    kernelRelease: options.kernelRelease,
    osRelease: parseOsRelease(fs.readFileSync(osReleasePath, "utf-8")),
    pciDevices,
    platform: options.platform,
  });
}

export function buildAmdPhoenixIronEnvironment(venvDirectory, source = process.env) {
  const sitePackages = path.join(venvDirectory, "lib", "python3.12", "site-packages");
  const libraryPaths = ["/usr/lib/x86_64-linux-gnu", "/lib/x86_64-linux-gnu"];
  if (source.LD_LIBRARY_PATH) libraryPaths.push(source.LD_LIBRARY_PATH);
  return {
    LD_LIBRARY_PATH: libraryPaths.join(":"),
    NPU_CACHE_HOME: path.join(
      path.dirname(venvDirectory),
      "amd-phoenix-iron",
      "cache",
    ),
    PEANO_INSTALL_DIR: path.join(sitePackages, "llvm-aie"),
    PYTHONPATH: ["/usr/lib/python3/dist-packages", source.PYTHONPATH].filter(Boolean).join(":"),
  };
}

export function buildAmdPhoenixIronConfig(agentDirectory, source = {}) {
  const runtimeRoot = path.join(agentDirectory, "indexing-service", "amd-phoenix-iron");
  return {
    amdIronArtifactDirectory: source.amdIronArtifactDirectory ?? path.join(runtimeRoot, "artifacts"),
    amdIronCacheDirectory: source.amdIronCacheDirectory ?? path.join(runtimeRoot, "cache"),
    amdIronSourceDirectory: source.amdIronSourceDirectory ?? path.join(runtimeRoot, "mlir-aie"),
    amdNpuGeneration: "npu1",
    amdNpuRuntimeVersion: AMD_PHOENIX_IRON_MANIFEST.mlirAieVersion,
  };
}

export function installAmdPhoenixIronSystemRuntime(options = {}) {
  const platformPlan = options.platformPlan ?? inspectAmdPhoenixIronPlatform(options);
  const agentDirectory = options.agentDirectory ?? path.join(os.homedir(), ".p", "agent");
  const runtimeRoot = path.join(agentDirectory, "indexing-service", "amd-phoenix-iron");
  if (options.dryRun) return { installed: false, platformPlan, runtimeRoot };
  if (platformPlan.requiresKernelUpgrade) {
    installUbuntuHweKernel();
    throw new Error(
      "Installed the Ubuntu HWE kernel required by MLIR-AIE. Reboot and rerun the installer to continue.",
    );
  }
  if (ensureAmdNpuAccess()) {
    throw new Error("Added the current user to the render group. Log out and back in, then rerun the installer.");
  }
  let installed = false;
  if (!validateAmdPhoenixIronSystemRuntime({ allowFailure: true })) {
    installAmdXdnaPpaRuntime(AMD_PHOENIX_IRON_MANIFEST.systemPackages);
    validateAmdPhoenixIronSystemRuntime();
    installed = true;
  }
  installPinnedMlirAieSource(runtimeRoot, AMD_PHOENIX_IRON_MANIFEST);
  return { installed, platformPlan, runtimeRoot };
}

export function installAmdPhoenixIronPythonRuntime(venvPython, options = {}) {
  if (options.dryRun) return;
  runCommand(venvPython, [
    "-m",
    "pip",
    "install",
    "--disable-pip-version-check",
    "--only-binary=:all:",
    `llvm-aie==${AMD_PHOENIX_IRON_MANIFEST.peanoVersion}`,
    "--find-links",
    AMD_PHOENIX_IRON_MANIFEST.peanoWheelIndex,
  ]);
  runCommand(venvPython, [
    "-m",
    "pip",
    "install",
    "--disable-pip-version-check",
    "--only-binary=:all:",
    `mlir_aie==${AMD_PHOENIX_IRON_MANIFEST.mlirAieVersion}`,
    "--find-links",
    AMD_PHOENIX_IRON_MANIFEST.mlirAieWheelIndex,
  ]);
  validateAmdPhoenixIronPythonRuntime(venvPython);
  prepareAmdPhoenixQwenArtifact(venvPython, options);
}

export function prepareAmdPhoenixQwenArtifact(venvPython, options = {}) {
  const agentDirectory = options.agentDirectory ?? path.join(os.homedir(), ".p", "agent");
  const managedConfig = buildAmdPhoenixIronConfig(agentDirectory, options);
  const environment = {
    ...process.env,
    ...buildAmdPhoenixIronEnvironment(path.dirname(path.dirname(venvPython))),
  };
  captureCommand(venvPython, [
    PHOENIX_QWEN_ARTIFACT,
    "--artifact-directory",
    managedConfig.amdIronArtifactDirectory,
    "--cache-directory",
    managedConfig.amdIronCacheDirectory,
    "--source-directory",
    managedConfig.amdIronSourceDirectory,
    "--json",
  ], { env: environment });
}

export function validateAmdPhoenixIronSystemRuntime(options = {}) {
  const xrtSmi = fs.existsSync(XRT_SMI) ? XRT_SMI : findOnPath("xrt-smi");
  if (!xrtSmi) return validationFailure(options, "AMD XRT is not installed: xrt-smi was not found");
  const output = captureCommand(xrtSmi, ["examine"], { allowFailure: options.allowFailure });
  const deviceNodePresent = fs.existsSync("/dev/accel/accel0") || fs.existsSync("/dev/amdxdna");
  const packagesMatch = Object.entries(AMD_PHOENIX_IRON_MANIFEST.systemPackages).every(
    ([packageName, expectedVersion]) =>
      captureCommand("dpkg-query", ["-W", "-f=${Version}", packageName], { allowFailure: true }).trim()
        === expectedVersion,
  );
  if (!packagesMatch) {
    return validationFailure(options, "Installed AMD XRT/XDNA package versions do not match the Phoenix manifest");
  }
  if (!deviceNodePresent || !/Phoenix|RyzenAI-npu1|NPU/i.test(output)) {
    return validationFailure(options, "XRT did not enumerate a usable AMD Phoenix npu1 device");
  }
  return true;
}

export function validateAmdPhoenixIronPythonRuntime(venvPython) {
  const environment = { ...process.env, ...buildAmdPhoenixIronEnvironment(path.dirname(path.dirname(venvPython))) };
  const metadata = JSON.parse(captureCommand(venvPython, [
    "-c",
    [
      "import importlib.metadata as metadata, json",
      "import aie.iron",
      "print(json.dumps({'mlirAieVersion': metadata.version('mlir_aie'), 'ironImport': True}))",
    ].join("\n"),
  ], { env: environment }));
  if (!String(metadata.mlirAieVersion).startsWith(AMD_PHOENIX_IRON_MANIFEST.mlirAieVersion)) {
    throw new Error(`Expected mlir_aie ${AMD_PHOENIX_IRON_MANIFEST.mlirAieVersion}, installed ${metadata.mlirAieVersion}`);
  }
  validateAmdPhoenixIronSystemRuntime();
  const probe = JSON.parse(captureCommand(venvPython, [PHOENIX_PROBE, "--json"], { env: environment }));
  if (!probe.dispatchVerified || probe.deviceGeneration !== "npu1") {
    throw new Error(`AMD Phoenix IRON NPU probe did not verify npu1 dispatch: ${JSON.stringify(probe)}`);
  }
  return { ...metadata, probe };
}

function validationFailure(options, message) {
  if (options.allowFailure) return false;
  throw new Error(message);
}

function detectPhoenixDevices(sysfsRoot) {
  let entries;
  try {
    entries = fs.readdirSync(sysfsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const devices = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const root = path.join(sysfsRoot, entry.name);
    const vendor = readTrimmedFile(path.join(root, "vendor"));
    const device = readTrimmedFile(path.join(root, "device"));
    if (normalizeHex(vendor, 4) !== "0x1022" || normalizeHex(device, 4) !== "0x1502") continue;
    devices.push({
      address: entry.name,
      device,
      revision: readTrimmedFile(path.join(root, "revision")),
      vendor,
    });
  }
  return devices;
}
