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
	runElevated,
	writeJsonAtomic,
} from "./npu-install-utils.js";
import { installAmdXdnaDriver, installUbuntuHweKernel } from "./install-amd-xdna-driver.js";

export { parseKernelVersion, parseOsRelease } from "./npu-install-utils.js";

export const AMD_RYZEN_AI_MANIFEST = Object.freeze({
	ryzenAiVersion: "1.7.1",
	supportedPlatform: "linux-x64",
	supportedOs: Object.freeze({ id: "ubuntu", versionId: "24.04" }),
	minimumKernel: Object.freeze([6, 10, 0]),
	pythonVersion: "3.12",
	onnxRuntimeVitisAiVersion: "1.23.3",
	voeVersion: "1.7.1",
	pythonIndexUrl: "https://pypi.amd.com/ryzenai_llm/1.7.1/linux/simple/",
	xdnaDriver: Object.freeze({
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
const AMD_LEGACY_NPU_DEVICE_ID = "0x1502";
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
	const pciDevices = options.pciDevices ?? [];
	const amdNpuDevices = pciDevices.filter((device) => normalizeHex(device.vendor, 4) === AMD_VENDOR_ID);
	const supportedDevice = amdNpuDevices.find((device) =>
		AMD_RYZEN_AI_MANIFEST.supportedPciDevices.some(
			(candidate) =>
				normalizeHex(device.device, 4) === candidate.device
				&& normalizeHex(device.revision, 2) === candidate.revision,
		),
	);
	if (!supportedDevice) {
		if (amdNpuDevices.some((device) => normalizeHex(device.device, 4) === AMD_LEGACY_NPU_DEVICE_ID)) {
			throw new Error(
				"AMD PHX/HPT NPU hardware was detected, but the current Ryzen AI Linux release supports STX and KRK",
			);
		}
		throw new Error("No supported AMD STX/KRK XDNA NPU PCI device was detected");
	}
	const supportedDescriptor = AMD_RYZEN_AI_MANIFEST.supportedPciDevices.find(
		(candidate) =>
			candidate.device === normalizeHex(supportedDevice.device, 4)
			&& candidate.revision === normalizeHex(supportedDevice.revision, 2),
	);
	const kernelVersion = parseKernelVersion(options.kernelRelease ?? os.release());
	return {
		apuType: supportedDescriptor.apuType,
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
		const revision = readTrimmedFile(path.join(deviceRoot, "revision"));
		if (normalizeHex(vendor, 4) !== AMD_VENDOR_ID) continue;
		if (!["0x17f0", AMD_LEGACY_NPU_DEVICE_ID].includes(normalizeHex(device, 4))) continue;
		devices.push({ address: entry.name, device, revision, vendor });
	}
	return devices;
}

export function buildAmdRyzenAiEnvironment(venvDirectory, source = process.env) {
	const libraryPaths = [
		path.join(venvDirectory, "lib", "python3.12", "site-packages", "voe", "lib"),
		path.join(XRT_ROOT, "lib"),
		"/lib/x86_64-linux-gnu",
	];
	if (source.LD_LIBRARY_PATH) libraryPaths.push(source.LD_LIBRARY_PATH);
	const environment = {
		LD_LIBRARY_PATH: libraryPaths.join(":"),
		P_CODE_RAG_VITISAI_CACHE_DIR:
			source.P_CODE_RAG_VITISAI_CACHE_DIR ?? path.join(path.dirname(venvDirectory), "vitisai-cache"),
		P_CODE_RAG_VITISAI_CACHE_KEY:
			source.P_CODE_RAG_VITISAI_CACHE_KEY
			?? `Qwen_Qwen3-Embedding-0.6B-ryzen-ai-${AMD_RYZEN_AI_MANIFEST.ryzenAiVersion}`,
		RYZEN_AI_INSTALLATION_PATH: venvDirectory,
		XILINX_XRT: XRT_ROOT,
	};
	if (source.P_CODE_RAG_VITISAI_CONFIG_FILE) {
		environment.P_CODE_RAG_VITISAI_CONFIG_FILE = source.P_CODE_RAG_VITISAI_CONFIG_FILE;
	}
	if (source.P_CODE_RAG_VITISAI_LOG_LEVEL) {
		environment.P_CODE_RAG_VITISAI_LOG_LEVEL = source.P_CODE_RAG_VITISAI_LOG_LEVEL;
	}
	return environment;
}

export function inspectAmdRyzenAiPlatform(options = {}) {
	const osReleasePath = options.osReleasePath ?? "/etc/os-release";
	const osRelease = parseOsRelease(fs.readFileSync(osReleasePath, "utf-8"));
	const pciDevices = options.pciDevices ?? detectAmdNpuPciDevices(options.sysfsRoot);
	return resolveAmdRyzenAiPlatform({
		architecture: options.architecture,
		kernelRelease: options.kernelRelease,
		osRelease,
		pciDevices,
		platform: options.platform,
	});
}

export function installAmdRyzenAiSystemRuntime(options = {}) {
	const dryRun = options.dryRun ?? false;
	const agentDirectory = options.agentDirectory ?? path.join(os.homedir(), ".p", "agent");
	const serviceRoot = path.join(agentDirectory, "indexing-service");
	const runtimeRoot = path.join(serviceRoot, "amd-ryzen-ai");
	const platformPlan = inspectAmdRyzenAiPlatform(options);
	if (dryRun) {
		return { installed: false, platformPlan, runtimeRoot };
	}
	if (platformPlan.requiresKernelUpgrade) {
		installUbuntuHweKernel();
		throw new Error(
			"Installed the Ubuntu 24.04 HWE kernel required by AMD Ryzen AI. "
			+ "A reboot is required before the automatic NPU installation can continue; reboot and rerun the installer.",
		);
	}
	const installationRecord = readJsonFile(path.join(runtimeRoot, "installed.json"));
	if (
		installationRecord?.manifest?.xdnaDriver?.commit === AMD_RYZEN_AI_MANIFEST.xdnaDriver.commit
		&& validateAmdRyzenAiSystemRuntime({ allowFailure: true })
	) {
		return { installed: false, platformPlan, runtimeRoot };
	}

	installAmdXdnaDriver(runtimeRoot, AMD_RYZEN_AI_MANIFEST);
	validateAmdRyzenAiSystemRuntime();
	writeJsonAtomic(path.join(runtimeRoot, "installed.json"), {
		installedAt: new Date().toISOString(),
		manifest: AMD_RYZEN_AI_MANIFEST,
		platform: platformPlan,
	});
	return { installed: true, platformPlan, runtimeRoot };
}

export function installAmdRyzenAiPythonRuntime(venvPython, options = {}) {
	const dryRun = options.dryRun ?? false;
	if (dryRun) return;
	for (const packageName of ["onnxruntime", "onnxruntime-openvino", "onnxruntime-vitisai", "voe"]) {
		runCommand(venvPython, ["-m", "pip", "uninstall", "-y", packageName], { allowFailure: true });
	}
	runCommand(venvPython, [
		"-m",
		"pip",
		"install",
		"--disable-pip-version-check",
		"--only-binary=:all:",
		"--extra-index-url",
		AMD_RYZEN_AI_MANIFEST.pythonIndexUrl,
		`onnxruntime-vitisai==${AMD_RYZEN_AI_MANIFEST.onnxRuntimeVitisAiVersion}`,
		`voe==${AMD_RYZEN_AI_MANIFEST.voeVersion}`,
	]);
	validateAmdRyzenAiPythonRuntime(venvPython);
}

export function validateAmdRyzenAiPythonRuntime(venvPython) {
	const result = JSON.parse(
		captureCommand(venvPython, [
			"-c",
			[
				"import json, onnxruntime as ort",
				"providers = ort.get_available_providers()",
				"assert 'VitisAIExecutionProvider' in providers, providers",
				"print(json.dumps({'providers': providers, 'version': ort.__version__}))",
			].join("\n"),
		]),
	);
	if (result.version !== AMD_RYZEN_AI_MANIFEST.onnxRuntimeVitisAiVersion) {
		throw new Error(
			`Expected onnxruntime-vitisai ${AMD_RYZEN_AI_MANIFEST.onnxRuntimeVitisAiVersion}, `
			+ `installed ${result.version}`,
		);
	}
	return result;
}

export function validateAmdRyzenAiSystemRuntime(options = {}) {
	const allowFailure = options.allowFailure ?? false;
	const xrtSmi = fs.existsSync(XRT_SMI) ? XRT_SMI : findOnPath("xrt-smi");
	if (!xrtSmi) {
		if (allowFailure) return false;
		throw new Error("AMD XRT is not installed: xrt-smi was not found");
	}
	const output = captureCommand(xrtSmi, ["examine"], { allowFailure });
	const deviceNodePresent = fs.existsSync("/dev/accel/accel0") || fs.existsSync("/dev/amdxdna");
	const npuEnumerated = /NPU|RyzenAI|Strix|Krackan/i.test(output);
	if (deviceNodePresent && npuEnumerated) return true;
	if (allowFailure) return false;
	throw new Error("AMD XRT installed, but no usable XDNA NPU was enumerated by xrt-smi examine");
}
