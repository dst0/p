import assert from "node:assert/strict";
import test from "node:test";
import {
	AMD_RYZEN_AI_MANIFEST,
	buildAmdRyzenAiConfig,
	buildAmdRyzenAiEnvironment,
	parseKernelVersion,
	parseOsRelease,
	resolveAmdRyzenAiPlatform,
} from "./install-amd-ryzen-ai.js";

test("pins the matched Ryzen AI, XRT, driver, Python, and ONNX Runtime stack", () => {
	assert.deepEqual(
		{
			driverPackages: AMD_RYZEN_AI_MANIFEST.driverPackages,
			installedDriverPackages: AMD_RYZEN_AI_MANIFEST.installedDriverPackages,
			driverSha256: AMD_RYZEN_AI_MANIFEST.driverArchive.sha256,
			ryzenAiVersion: AMD_RYZEN_AI_MANIFEST.ryzenAiVersion,
			pythonVersion: AMD_RYZEN_AI_MANIFEST.pythonVersion,
			optimumVersion: AMD_RYZEN_AI_MANIFEST.optimumVersion,
			optimumOnnxVersion: AMD_RYZEN_AI_MANIFEST.optimumOnnxVersion,
		},
		{
			driverPackages: [
				"xrt_202620.2.25.37_24.04-amd64-base.deb",
				"xrt_202620.2.25.37_24.04-amd64-base-dev.deb",
				"xrt_202620.2.25.37_24.04-amd64-npu.deb",
				"xrt_plugin.2.25.260102.56.release_24.04-amd64-amdxdna.deb",
			],
			driverSha256: "ea37ce2ff46ae20e64a081c38fc45b3bae183e488f293543c811f4c05186d2df",
			installedDriverPackages: {
				"xrt-base": "2.25.37",
				"xrt-base-dev": "2.25.37",
				"xrt-npu": "2.25.37",
				"xrt_plugin-amdxdna": "2.25",
			},
			ryzenAiVersion: "1.8.0",
			pythonVersion: "3.12",
			optimumVersion: "2.1.0",
			optimumOnnxVersion: "0.1.0",
		},
	);
});

test("parses quoted os-release values and numeric kernel components", () => {
	assert.deepEqual(parseOsRelease('ID=ubuntu\nVERSION_ID="24.04"\nNAME="Ubuntu"\n'), {
		ID: "ubuntu",
		VERSION_ID: "24.04",
		NAME: "Ubuntu",
	});
	assert.deepEqual(parseKernelVersion("6.11.0-29-generic"), [6, 11, 0]);
});

test("accepts the official Linux STX and KRK hardware matrix", () => {
	for (const revision of ["00", "10", "11", "20"]) {
		const plan = resolveAmdRyzenAiPlatform({
			platform: "linux",
			architecture: "x64",
			osRelease: { ID: "ubuntu", VERSION_ID: "24.04" },
			kernelRelease: "6.11.0-29-generic",
			pciDevices: [{ vendor: "0x1022", device: "0x17f0", revision: `0x${revision}` }],
		});
		assert.equal(plan.supported, true);
		assert.equal(plan.apuType, revision === "20" ? "KRK" : "STX");
		assert.equal(plan.requiresKernelUpgrade, false);
	}
});

test("rejects PHX/HPT and unsupported Linux distributions truthfully", () => {
	assert.throws(
		() =>
			resolveAmdRyzenAiPlatform({
				platform: "linux",
				architecture: "x64",
				osRelease: { ID: "ubuntu", VERSION_ID: "24.04" },
				kernelRelease: "6.11.0",
				pciDevices: [{ vendor: "0x1022", device: "0x1502", revision: "0x00" }],
			}),
		/No supported AMD STX\/KRK/,
	);
	assert.throws(
		() =>
			resolveAmdRyzenAiPlatform({
				platform: "linux",
				architecture: "x64",
				osRelease: { ID: "debian", VERSION_ID: "13" },
				kernelRelease: "6.12.0",
				pciDevices: [{ vendor: "0x1022", device: "0x17f0", revision: "0x10" }],
			}),
		/Ubuntu 24.04/,
	);
});

test("marks Ubuntu 24.04 kernels older than 6.10 for automatic HWE upgrade", () => {
	const plan = resolveAmdRyzenAiPlatform({
		platform: "linux",
		architecture: "x64",
		osRelease: { ID: "ubuntu", VERSION_ID: "24.04" },
		kernelRelease: "6.8.0-88-generic",
		pciDevices: [{ vendor: "0x1022", device: "0x17f0", revision: "0x10" }],
	});
	assert.equal(plan.requiresKernelUpgrade, true);
});

test("builds the managed service environment for the official Ryzen AI package", () => {
	assert.deepEqual(
		buildAmdRyzenAiEnvironment("/home/test/.p/agent/indexing-service/venv", {
			LD_LIBRARY_PATH: "/custom/lib",
		}),
		{
			LD_LIBRARY_PATH:
				"/home/test/.p/agent/indexing-service/venv/onnxruntime/lib:/opt/xilinx/xrt/lib:/lib/x86_64-linux-gnu:/custom/lib",
			RYZEN_AI_INSTALLATION_PATH: "/home/test/.p/agent/indexing-service/venv",
			XILINX_XRT: "/opt/xilinx/xrt",
		},
	);
	assert.deepEqual(buildAmdRyzenAiConfig("/home/test/.p/agent/indexing-service/venv"), {
		amdNpuGeneration: "npu2",
		amdNpuRuntimeVersion: "1.8.0",
		ryzenAiArchivePath: undefined,
		vitisaiCacheDirectory: "/home/test/.p/agent/indexing-service/vitisai-cache",
		vitisaiCacheKey: "Qwen_Qwen3-Embedding-0.6B-ryzen-ai-1.8.0",
		vitisaiConfigFile: undefined,
	});
});
