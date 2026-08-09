#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  captureCommand,
  compareVersions,
  findOnPath,
  normalizeHex,
  parseKernelVersion,
  parseOsRelease,
  readJsonFile,
  readTrimmedFile,
  runCommand,
  writeJsonAtomic,
} from "./npu-install-utils.js";
import { installAmdXdnaDriver, installUbuntuHweKernel } from "./install-amd-xdna-driver.js";
import {
  installOfficialRyzenAiDriverArchive,
  resolveRyzenAiArchive,
} from "./install-amd-ryzen-ai-packages.js";

export { parseKernelVersion, parseOsRelease } from "./npu-install-utils.js";

export const AMD_RYZEN_AI_MANIFEST = Object.freeze({
  backendId: "amd-ryzenai-npu",
  ryzenAiVersion: "1.8.0",
  archiveName: "ryzen_ai-1.8.0.tgz",
  archiveDownloadPage:
    "https://account.amd.com/en/forms/downloads/ryzenai-eula-public-xef.html?filename=ryzen_ai-1.8.0.tgz",
  driverArchive: Object.freeze({
    name: "RAI_1.8_Linux_NPU_XRT.zip",
    url: "https://download.amd.com/opendownload/RyzenAI/Driver/RAI_1.8_Linux_NPU_XRT.zip",
    sha256: "ea37ce2ff46ae20e64a081c38fc45b3bae183e488f293543c811f4c05186d2df",
  }),
  driverPackages: Object.freeze([
    "xrt_202620.2.25.37_24.04-amd64-base.deb",
    "xrt_202620.2.25.37_24.04-amd64-base-dev.deb",
    "xrt_202620.2.25.37_24.04-amd64-npu.deb",
    "xrt_plugin.2.25.260102.56.release_24.04-amd64-amdxdna.deb",
  ]),
  installedDriverPackages: Object.freeze({
    "xrt-base": "2.25.37",
    "xrt-base-dev": "2.25.37",
    "xrt-npu": "2.25.37",
    "xrt_plugin-amdxdna": "2.25",
  }),
  supportedPlatform: "linux-x64",
  supportedOs: Object.freeze({ id: "ubuntu", versionId: "24.04" }),
  minimumKernel: Object.freeze([6, 10, 0]),
  pythonVersion: "3.12",
  optimumVersion: "2.1.0",
  optimumOnnxVersion: "0.1.0",
  sourceFallback: Object.freeze({
    repository: "https://github.com/amd/xdna-driver.git",
    tag: "2.21.75",
    commit: "beb9e450fe123ecdf395453971576179cedcf1dd",
  }),
  supportedPciDevices: Object.freeze([
    Object.freeze({ device: "0x17f0", revision: "0x00", apuType: "STX" }),
    Object.freeze({ device: "0x17f0", revision: "0x10", apuType: "STX" }),
    Object.freeze({ device: "0x17f0", revision: "0x11", apuType: "STX" }),
    Object.freeze({ device: "0x17f0", revision: "0x20", apuType: "KRK" }),
  ]),
});

const AMD_VENDOR_ID = "0x1022";
const XRT_ROOT = "/opt/xilinx/xrt";
const XRT_SMI = path.join(XRT_ROOT, "bin", "xrt-smi");

export function resolveAmdRyzenAiPlatform(options) {
  const platform = options.platform ?? process.platform;
  const architecture = options.architecture ?? process.arch;
  if (platform !== "linux" || architecture !== "x64") {
    throw new Error(`AMD Ryzen AI indexing requires Linux x64, found ${platform}/${architecture}`);
  }
  const osRelease = options.osRelease ?? {};
  if (
    osRelease.ID !== AMD_RYZEN_AI_MANIFEST.supportedOs.id
    || osRelease.VERSION_ID !== AMD_RYZEN_AI_MANIFEST.supportedOs.versionId
  ) {
    throw new Error(
      `AMD Ryzen AI ${AMD_RYZEN_AI_MANIFEST.ryzenAiVersion} requires Ubuntu 24.04; `
      + `found ${osRelease.ID ?? "unknown"} ${osRelease.VERSION_ID ?? "unknown"}`,
    );
  }
  const supportedDevice = (options.pciDevices ?? []).find((device) =>
    AMD_RYZEN_AI_MANIFEST.supportedPciDevices.some(
      (candidate) => normalizeHex(device.vendor, 4) === AMD_VENDOR_ID
        && normalizeHex(device.device, 4) === candidate.device
        && normalizeHex(device.revision, 2) === candidate.revision,
    ),
  );
  if (!supportedDevice) throw new Error("No supported AMD STX/KRK XDNA NPU PCI device was detected");
  const descriptor = AMD_RYZEN_AI_MANIFEST.supportedPciDevices.find(
    (candidate) => candidate.device === normalizeHex(supportedDevice.device, 4)
      && candidate.revision === normalizeHex(supportedDevice.revision, 2),
  );
  const kernelVersion = parseKernelVersion(options.kernelRelease ?? os.release());
  return {
    apuType: descriptor.apuType,
    backendId: AMD_RYZEN_AI_MANIFEST.backendId,
    deviceGeneration: "npu2",
    kernelVersion,
    pciDevice: supportedDevice,
    requiresKernelUpgrade: compareVersions(kernelVersion, AMD_RYZEN_AI_MANIFEST.minimumKernel) < 0,
    supported: true,
  };
}

export function detectAmdNpuPciDevices(sysfsRoot = "/sys/bus/pci/devices") {
  let entries;
  try {
    entries = fs.readdirSync(sysfsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const devices = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const deviceRoot = path.join(sysfsRoot, entry.name);
    const vendor = readTrimmedFile(path.join(deviceRoot, "vendor"));
    const device = readTrimmedFile(path.join(deviceRoot, "device"));
    if (normalizeHex(vendor, 4) !== AMD_VENDOR_ID) continue;
    if (!["0x17f0", "0x1502"].includes(normalizeHex(device, 4))) continue;
    devices.push({
      address: entry.name,
      device,
      revision: readTrimmedFile(path.join(deviceRoot, "revision")),
      vendor,
    });
  }
  return devices;
}

export function buildAmdRyzenAiEnvironment(venvDirectory, source = process.env) {
  const libraryPaths = [
    path.join(venvDirectory, "onnxruntime", "lib"),
    path.join(XRT_ROOT, "lib"),
    "/lib/x86_64-linux-gnu",
  ];
  if (source.LD_LIBRARY_PATH) libraryPaths.push(source.LD_LIBRARY_PATH);
  return {
    LD_LIBRARY_PATH: libraryPaths.join(":"),
    RYZEN_AI_INSTALLATION_PATH: venvDirectory,
    XILINX_XRT: XRT_ROOT,
  };
}

export function buildAmdRyzenAiConfig(venvDirectory, source = {}) {
  return {
    amdNpuGeneration: "npu2",
    amdNpuRuntimeVersion: AMD_RYZEN_AI_MANIFEST.ryzenAiVersion,
    ryzenAiArchivePath: source.ryzenAiArchivePath,
    vitisaiCacheDirectory: source.vitisaiCacheDirectory ?? path.join(path.dirname(venvDirectory), "vitisai-cache"),
    vitisaiCacheKey: source.vitisaiCacheKey ?? "Qwen_Qwen3-Embedding-0.6B-ryzen-ai-1.8.0",
    vitisaiConfigFile: source.vitisaiConfigFile,
  };
}

export function inspectAmdRyzenAiPlatform(options = {}) {
  const osRelease = parseOsRelease(fs.readFileSync(options.osReleasePath ?? "/etc/os-release", "utf-8"));
  return resolveAmdRyzenAiPlatform({
    architecture: options.architecture,
    kernelRelease: options.kernelRelease,
    osRelease,
    pciDevices: options.pciDevices ?? detectAmdNpuPciDevices(options.sysfsRoot),
    platform: options.platform,
  });
}

export function installAmdRyzenAiSystemRuntime(options = {}) {
  const platformPlan = inspectAmdRyzenAiPlatform(options);
  const agentDirectory = options.agentDirectory ?? path.join(os.homedir(), ".p", "agent");
  const runtimeRoot = path.join(agentDirectory, "indexing-service", "amd-ryzen-ai");
  if (options.dryRun) return { installed: false, platformPlan, runtimeRoot };
  if (platformPlan.requiresKernelUpgrade) {
    installUbuntuHweKernel();
    throw new Error("Installed the required Ubuntu HWE kernel. Reboot and rerun the installer to continue.");
  }
  if (validateAmdRyzenAiSystemRuntime({ allowFailure: true })) {
    return { installed: false, platformPlan, runtimeRoot };
  }
  try {
    installOfficialRyzenAiDriverArchive(runtimeRoot, AMD_RYZEN_AI_MANIFEST);
  } catch (error) {
    if (!options.allowSourceBuild) throw error;
    installAmdXdnaDriver(runtimeRoot, { xdnaDriver: AMD_RYZEN_AI_MANIFEST.sourceFallback });
  }
  validateAmdRyzenAiSystemRuntime();
  writeJsonAtomic(path.join(runtimeRoot, "installed.json"), {
    installedAt: new Date().toISOString(),
    manifest: AMD_RYZEN_AI_MANIFEST,
    platform: platformPlan,
  });
  return { installed: true, platformPlan, runtimeRoot };
}

export function installAmdRyzenAiPythonRuntime(venvPython, options = {}) {
  if (options.dryRun) return;
  const archivePath = resolveRyzenAiArchive(options, AMD_RYZEN_AI_MANIFEST);
  const extractionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "p-ryzen-ai-1.8-"));
  try {
    runCommand("tar", ["-xzf", archivePath, "-C", extractionRoot]);
    const installer = findRequiredFile(extractionRoot, "install_ryzen_ai.sh");
    runCommand(installer, ["-a", "yes", "-p", path.dirname(path.dirname(venvPython))], {
      cwd: path.dirname(installer),
    });
  } finally {
    fs.rmSync(extractionRoot, { force: true, recursive: true });
  }
  runCommand(venvPython, [
    "-m",
    "pip",
    "install",
    "--disable-pip-version-check",
    "--no-deps",
    `optimum==${AMD_RYZEN_AI_MANIFEST.optimumVersion}`,
    `optimum-onnx==${AMD_RYZEN_AI_MANIFEST.optimumOnnxVersion}`,
  ]);
  const versions = validateAmdRyzenAiPythonRuntime(venvPython, options);
  const agentDirectory = options.agentDirectory ?? path.join(os.homedir(), ".p", "agent");
  const runtimeRoot = path.join(agentDirectory, "indexing-service", "amd-ryzen-ai");
  writeJsonAtomic(path.join(runtimeRoot, "python-runtime.json"), versions);
  return versions;
}

export function validateAmdRyzenAiPythonRuntime(venvPython, options = {}) {
  const environment = {
    ...process.env,
    ...buildAmdRyzenAiEnvironment(path.dirname(path.dirname(venvPython)), options.environment),
  };
  const result = JSON.parse(captureCommand(venvPython, ["-c", [
    "import importlib.metadata as metadata, json, onnxruntime as ort",
    "from optimum.onnxruntime import ORTModelForFeatureExtraction",
    "providers = ort.get_available_providers()",
    "assert 'VitisAIExecutionProvider' in providers, providers",
    "def version(name):",
    "  try: return metadata.version(name)",
    "  except metadata.PackageNotFoundError: return None",
    "print(json.dumps({'onnxruntime': ort.__version__, 'optimum': version('optimum'),",
    "  'optimumOnnx': version('optimum-onnx'), 'providers': providers, 'voe': version('voe')}))",
  ].join("\n")], { env: environment }));
  if (!result.voe) throw new Error("Ryzen AI 1.8 installed without a detectable VOE package version");
  if (result.optimum !== AMD_RYZEN_AI_MANIFEST.optimumVersion) {
    throw new Error(`Expected optimum ${AMD_RYZEN_AI_MANIFEST.optimumVersion}, installed ${result.optimum}`);
  }
  if (result.optimumOnnx !== AMD_RYZEN_AI_MANIFEST.optimumOnnxVersion) {
    throw new Error(`Expected optimum-onnx ${AMD_RYZEN_AI_MANIFEST.optimumOnnxVersion}, installed ${result.optimumOnnx}`);
  }
  return result;
}

export function validateAmdRyzenAiSystemRuntime(options = {}) {
  const xrtSmi = fs.existsSync(XRT_SMI) ? XRT_SMI : findOnPath("xrt-smi");
  if (!xrtSmi) return validationFailure(options, "AMD XRT is not installed: xrt-smi was not found");
  const output = captureCommand(xrtSmi, ["examine"], { allowFailure: options.allowFailure });
  const deviceNodePresent = fs.existsSync("/dev/accel/accel0") || fs.existsSync("/dev/amdxdna");
  const packagesMatch = Object.entries(AMD_RYZEN_AI_MANIFEST.installedDriverPackages).every(
    ([packageName, expectedVersion]) =>
      captureCommand("dpkg-query", ["-W", "-f=${Version}", packageName], { allowFailure: true }).trim()
        === expectedVersion,
  );
  if (deviceNodePresent && packagesMatch && /NPU|Strix|Krackan/i.test(output)) return true;
  if (!packagesMatch) {
    return validationFailure(options, "Installed Ryzen AI XRT/plugin package versions do not match 1.8");
  }
  return validationFailure(options, "AMD XRT installed, but no usable STX/KRK NPU was enumerated");
}

function validationFailure(options, message) {
  if (options.allowFailure) return false;
  throw new Error(message);
}
