import assert from "node:assert/strict";
import test from "node:test";
import {
	INTEL_OPENVINO_NPU_MANIFEST,
	buildIntelOpenVinoConfig,
	parseKernelVersion,
	parseOsRelease,
	resolveIntelOpenVinoNpuPlatform,
} from "./install-intel-openvino-npu.js";

test("pins the matched Intel NPU driver, Level Zero, OpenVINO, and Optimum Intel stack", () => {
	assert.deepEqual(
		{
			driverArchiveSha256: INTEL_OPENVINO_NPU_MANIFEST.driverArchive.sha256,
			driverVersion: INTEL_OPENVINO_NPU_MANIFEST.driverVersion,
			levelZeroVersion: INTEL_OPENVINO_NPU_MANIFEST.levelZero.version,
			openVinoVersion: INTEL_OPENVINO_NPU_MANIFEST.openVinoVersion,
			optimumIntelVersion: INTEL_OPENVINO_NPU_MANIFEST.optimumIntelVersion,
		},
		{
			driverArchiveSha256: "c4ad38bad6e1cdc609f68044ea3502366013e6a22758f698ffb532f48bd1ee48",
			driverVersion: "1.32.1",
			levelZeroVersion: "1.27.0",
			openVinoVersion: "2026.1.0",
			optimumIntelVersion: "2.1.0",
		},
	);
});

test("parses Intel host release metadata", () => {
	assert.deepEqual(parseOsRelease('ID=ubuntu\nVERSION_ID="24.04"\nNAME="Ubuntu"\n'), {
		ID: "ubuntu",
		VERSION_ID: "24.04",
		NAME: "Ubuntu",
	});
	assert.deepEqual(parseKernelVersion("6.17.0-20-generic"), [6, 17, 0]);
});

test("accepts every OpenVINO-supported Intel Core Ultra NPU family", () => {
	const expectedPlatforms = new Map([
		["0x7d1d", "Meteor Lake"],
		["0xad1d", "Arrow Lake"],
		["0x643e", "Lunar Lake"],
		["0xb03e", "Panther Lake"],
		["0xfd3e", "Wildcat Lake"],
	]);
	for (const [device, platform] of expectedPlatforms) {
		const plan = resolveIntelOpenVinoNpuPlatform({
			architecture: "x64",
			kernelRelease: "6.17.0-20-generic",
			osRelease: { ID: "ubuntu", VERSION_ID: "24.04" },
			pciDevices: [{ vendor: "0x8086", device }],
			platform: "linux",
		});
		assert.equal(plan.platform, platform);
		assert.equal(plan.requiresKernelUpgrade, false);
		assert.equal(plan.supported, true);
	}
});

test("rejects unsupported Intel devices and Linux distributions", () => {
	assert.throws(
		() =>
			resolveIntelOpenVinoNpuPlatform({
				architecture: "x64",
				kernelRelease: "6.17.0",
				osRelease: { ID: "ubuntu", VERSION_ID: "24.04" },
				pciDevices: [{ vendor: "0x8086", device: "0x1234" }],
				platform: "linux",
			}),
		/No supported Intel Core Ultra NPU PCI device/,
	);
	assert.throws(
		() =>
			resolveIntelOpenVinoNpuPlatform({
				architecture: "x64",
				kernelRelease: "6.17.0",
				osRelease: { ID: "debian", VERSION_ID: "13" },
				pciDevices: [{ vendor: "0x8086", device: "0x7d1d" }],
				platform: "linux",
			}),
		/Ubuntu 24.04/,
	);
});

test("marks kernels older than the Intel NPU minimum for automatic HWE upgrade", () => {
	const plan = resolveIntelOpenVinoNpuPlatform({
		architecture: "x64",
		kernelRelease: "6.6.0",
		osRelease: { ID: "ubuntu", VERSION_ID: "24.04" },
		pciDevices: [{ vendor: "0x8086", device: "0x643e" }],
		platform: "linux",
	});
	assert.equal(plan.requiresKernelUpgrade, true);
});

test("builds a persistent OpenVINO compilation cache config", () => {
	assert.deepEqual(buildIntelOpenVinoConfig("/home/test/.p/agent"), {
		openvinoCacheDirectory: "/home/test/.p/agent/indexing-service/openvino-cache",
	});
	assert.deepEqual(
		buildIntelOpenVinoConfig("/home/test/.p/agent", {
			openvinoCacheDirectory: "/srv/openvino-cache",
		}),
		{ openvinoCacheDirectory: "/srv/openvino-cache" },
	);
});
