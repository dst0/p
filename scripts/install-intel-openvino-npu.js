#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	captureCommand,
	compareVersions,
	normalizeHex,
	parseKernelVersion,
	parseOsRelease,
	readJsonFile,
	readTrimmedFile,
	runCommand,
	runElevated,
	writeJsonAtomic,
} from "./npu-install-utils.js";
import {
	downloadVerifiedFile,
	ensureIntelNpuUserAccess,
	findFiles,
	installIntelNpuAccessRule,
	installLevelZeroPackage,
	installSystemPrerequisites,
	installUbuntuHweKernel,
} from "./install-intel-npu-driver.js";

export { parseKernelVersion, parseOsRelease } from "./npu-install-utils.js";

export const INTEL_OPENVINO_NPU_MANIFEST = Object.freeze({
	driverVersion: "1.32.1",
	openVinoVersion: "2026.1.0",
	openVinoTokenizersVersion: "2026.1.0.0",
	optimumIntelVersion: "2.1.0",
	supportedPlatform: "linux-x64",
	supportedOs: Object.freeze({ id: "ubuntu", versionId: "24.04" }),
	minimumKernel: Object.freeze([6, 8, 0]),
	driverArchive: Object.freeze({
		name: "linux-npu-driver-v1.32.1.20260422-24767473183-ubuntu2404.tar.gz",
		sha256: "c4ad38bad6e1cdc609f68044ea3502366013e6a22758f698ffb532f48bd1ee48",
		url: "https://github.com/intel/linux-npu-driver/releases/download/v1.32.1/linux-npu-driver-v1.32.1.20260422-24767473183-ubuntu2404.tar.gz",
	}),
	levelZero: Object.freeze({
		version: "1.27.0",
		name: "libze1_1.27.0-1~24.04~ppa2_amd64.deb",
		sha256: "526808b420a2bd7b4ee24a99e9a71a35de820abe3e33c22dcb51c490da4439e0",
		url: "https://snapshot.ppa.launchpadcontent.net/kobuk-team/intel-graphics/ubuntu/20260324T100000Z/pool/main/l/level-zero-loader/libze1_1.27.0-1~24.04~ppa2_amd64.deb",
	}),
	supportedPciDevices: Object.freeze([
		Object.freeze({ device: "0x7d1d", platform: "Meteor Lake", npu: "NPU 3720" }),
		Object.freeze({ device: "0xad1d", platform: "Arrow Lake", npu: "NPU 3720" }),
		Object.freeze({ device: "0x643e", platform: "Lunar Lake", npu: "NPU 4000" }),
		Object.freeze({ device: "0xb03e", platform: "Panther Lake", npu: "NPU 5010" }),
		Object.freeze({ device: "0xfd3e", platform: "Wildcat Lake", npu: "NPU 5020" }),
	]),
});

const INTEL_VENDOR_ID = "0x8086";

export function resolveIntelOpenVinoNpuPlatform(options) {
	const platform = options.platform ?? process.platform;
	const architecture = options.architecture ?? process.arch;
	if (platform !== "linux" || architecture !== "x64") {
		throw new Error(`Intel OpenVINO NPU indexing requires Linux x64, found ${platform}/${architecture}`);
	}
	const osRelease = options.osRelease ?? {};
	if (
		osRelease.ID !== INTEL_OPENVINO_NPU_MANIFEST.supportedOs.id
		|| osRelease.VERSION_ID !== INTEL_OPENVINO_NPU_MANIFEST.supportedOs.versionId
	) {
		throw new Error(
			`Intel NPU driver ${INTEL_OPENVINO_NPU_MANIFEST.driverVersion} requires Ubuntu 24.04; `
			+ `found ${osRelease.ID ?? "unknown"} ${osRelease.VERSION_ID ?? "unknown"}`,
		);
	}
	const supportedDevice = (options.pciDevices ?? []).find(
		(device) =>
			normalizeHex(device.vendor, 4) === INTEL_VENDOR_ID
			&& INTEL_OPENVINO_NPU_MANIFEST.supportedPciDevices.some(
				(candidate) => candidate.device === normalizeHex(device.device, 4),
			),
	);
	if (!supportedDevice) {
		throw new Error("No supported Intel Core Ultra NPU PCI device was detected");
	}
	const descriptor = INTEL_OPENVINO_NPU_MANIFEST.supportedPciDevices.find(
		(candidate) => candidate.device === normalizeHex(supportedDevice.device, 4),
	);
	const kernelVersion = parseKernelVersion(options.kernelRelease ?? os.release());
	return {
		kernelVersion,
		npu: descriptor.npu,
		pciDevice: supportedDevice,
		platform: descriptor.platform,
		requiresKernelUpgrade: compareVersions(kernelVersion, INTEL_OPENVINO_NPU_MANIFEST.minimumKernel) < 0,
		supported: true,
	};
}

export function detectIntelNpuPciDevices(sysfsRoot = "/sys/bus/pci/devices") {
	let entries;
	try {
		entries = fs.readdirSync(sysfsRoot, { withFileTypes: true });
	} catch {
		return [];
	}
	const supportedIds = new Set(
		INTEL_OPENVINO_NPU_MANIFEST.supportedPciDevices.map((candidate) => candidate.device),
	);
	const devices = [];
	for (const entry of entries) {
		if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
		const deviceRoot = path.join(sysfsRoot, entry.name);
		const vendor = readTrimmedFile(path.join(deviceRoot, "vendor"));
		const device = readTrimmedFile(path.join(deviceRoot, "device"));
		if (normalizeHex(vendor, 4) !== INTEL_VENDOR_ID || !supportedIds.has(normalizeHex(device, 4))) continue;
		devices.push({
			address: entry.name,
			class: readTrimmedFile(path.join(deviceRoot, "class")),
			device,
			revision: readTrimmedFile(path.join(deviceRoot, "revision")),
			vendor,
		});
	}
	return devices;
}

export function buildIntelOpenVinoConfig(agentDirectory, source = {}) {
	return {
		openvinoCacheDirectory:
			source.openvinoCacheDirectory
			?? path.join(agentDirectory, "indexing-service", "openvino-cache"),
	};
}

export function inspectIntelOpenVinoNpuPlatform(options = {}) {
	const osReleasePath = options.osReleasePath ?? "/etc/os-release";
	const osRelease = parseOsRelease(fs.readFileSync(osReleasePath, "utf-8"));
	const pciDevices = options.pciDevices ?? detectIntelNpuPciDevices(options.sysfsRoot);
	return resolveIntelOpenVinoNpuPlatform({
		architecture: options.architecture,
		kernelRelease: options.kernelRelease,
		osRelease,
		pciDevices,
		platform: options.platform,
	});
}

export function installIntelOpenVinoNpuSystemRuntime(options = {}) {
	const dryRun = options.dryRun ?? false;
	const agentDirectory = options.agentDirectory ?? path.join(os.homedir(), ".p", "agent");
	const runtimeRoot = path.join(agentDirectory, "indexing-service", "intel-openvino-npu");
	const platformPlan = inspectIntelOpenVinoNpuPlatform(options);
	if (dryRun) return { installed: false, platformPlan, runtimeRoot };
	if (platformPlan.requiresKernelUpgrade) {
		installUbuntuHweKernel();
		throw new Error(
			"Installed the Ubuntu 24.04 HWE kernel required by Intel NPU. "
			+ "A reboot is required before the automatic NPU installation can continue; reboot and rerun the installer.",
		);
	}
	const installationRecord = readJsonFile(path.join(runtimeRoot, "installed.json"));
	if (
		installationRecord?.manifest?.driverVersion === INTEL_OPENVINO_NPU_MANIFEST.driverVersion
		&& validateIntelOpenVinoNpuSystemRuntime({ allowFailure: true, pciDevices: [platformPlan.pciDevice] })
	) {
		ensureIntelNpuUserAccess();
		return { installed: false, platformPlan, runtimeRoot };
	}

	fs.mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 });
	installSystemPrerequisites();
	const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "p-intel-npu-"));
	try {
		const driverArchive = path.join(temporaryDirectory, INTEL_OPENVINO_NPU_MANIFEST.driverArchive.name);
		const levelZeroPackage = path.join(temporaryDirectory, INTEL_OPENVINO_NPU_MANIFEST.levelZero.name);
		downloadVerifiedFile(
			INTEL_OPENVINO_NPU_MANIFEST.driverArchive.url,
			driverArchive,
			INTEL_OPENVINO_NPU_MANIFEST.driverArchive.sha256,
		);
		downloadVerifiedFile(
			INTEL_OPENVINO_NPU_MANIFEST.levelZero.url,
			levelZeroPackage,
			INTEL_OPENVINO_NPU_MANIFEST.levelZero.sha256,
		);
		const driverDirectory = path.join(temporaryDirectory, "driver");
		fs.mkdirSync(driverDirectory, { mode: 0o700 });
		runCommand("tar", ["-xzf", driverArchive, "--no-same-owner", "-C", driverDirectory]);
		const driverPackages = findFiles(driverDirectory, (name) => /^intel-.*\.deb$/.test(name));
		if (driverPackages.length === 0) {
			throw new Error(`Intel NPU driver archive contained no intel-*.deb packages: ${driverArchive}`);
		}
		installLevelZeroPackage(levelZeroPackage);
		runElevated("apt-get", ["install", "-y", "--allow-downgrades", ...driverPackages]);
	} finally {
		fs.rmSync(temporaryDirectory, { recursive: true, force: true });
	}

	installIntelNpuAccessRule();
	runElevated("modprobe", ["intel_vpu"], { allowFailure: true });
	runElevated("modprobe", ["intel_npu"], { allowFailure: true });
	runElevated("udevadm", ["control", "--reload-rules"], { allowFailure: true });
	runElevated("udevadm", ["trigger", "--subsystem-match=accel"], { allowFailure: true });
	ensureIntelNpuUserAccess();
	validateIntelOpenVinoNpuSystemRuntime({ pciDevices: [platformPlan.pciDevice] });
	writeJsonAtomic(path.join(runtimeRoot, "installed.json"), {
		installedAt: new Date().toISOString(),
		manifest: INTEL_OPENVINO_NPU_MANIFEST,
		platform: platformPlan,
	});
	return { installed: true, platformPlan, runtimeRoot };
}

export function installIntelOpenVinoPythonRuntime(venvPython, options = {}) {
	if (options.dryRun ?? false) return;
	for (const packageName of ["openvino", "openvino-tokenizers", "optimum-intel"]) {
		runCommand(venvPython, ["-m", "pip", "uninstall", "-y", packageName], { allowFailure: true });
	}
	runCommand(venvPython, [
		"-m",
		"pip",
		"install",
		"--disable-pip-version-check",
		"--only-binary=:all:",
		`openvino==${INTEL_OPENVINO_NPU_MANIFEST.openVinoVersion}`,
		`openvino-tokenizers==${INTEL_OPENVINO_NPU_MANIFEST.openVinoTokenizersVersion}`,
		`optimum-intel==${INTEL_OPENVINO_NPU_MANIFEST.optimumIntelVersion}`,
	]);
	validateIntelOpenVinoPythonRuntime(venvPython);
}

export function validateIntelOpenVinoPythonRuntime(venvPython) {
	const result = JSON.parse(
		captureCommand(venvPython, [
			"-c",
			[
				"import json, openvino as ov",
				"from optimum.intel import OVSentenceTransformer",
				"devices = list(ov.Core().available_devices)",
				"assert 'NPU' in devices, devices",
				"print(json.dumps({'devices': devices, 'version': ov.__version__}))",
			].join("\n"),
		]),
	);
	if (!String(result.version).startsWith(INTEL_OPENVINO_NPU_MANIFEST.openVinoVersion)) {
		throw new Error(
			`Expected OpenVINO ${INTEL_OPENVINO_NPU_MANIFEST.openVinoVersion}, installed ${result.version}`,
		);
	}
	return result;
}

export function validateIntelOpenVinoNpuSystemRuntime(options = {}) {
	const allowFailure = options.allowFailure ?? false;
	const pciDevices = options.pciDevices ?? detectIntelNpuPciDevices(options.sysfsRoot);
	const deviceNodePresent = findAccelDeviceNodes().length > 0;
	if (pciDevices.length > 0 && deviceNodePresent) return true;
	if (allowFailure) return false;
	throw new Error("Intel NPU hardware was detected, but no /dev/accel/accel* device is available");
}
