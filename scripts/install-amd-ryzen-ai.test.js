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
			ryzenAiVersion: AMD_RYZEN_AI_MANIFEST.ryzenAiVersion,
			xdnaDriverTag: AMD_RYZEN_AI_MANIFEST.xdnaDriver.tag,
			xdnaDriverCommit: AMD_RYZEN_AI_MANIFEST.xdnaDriver.commit,
			pythonVersion: AMD_RYZEN_AI_MANIFEST.pythonVersion,
			onnxRuntimeVitisAiVersion: AMD_RYZEN_AI_MANIFEST.onnxRuntimeVitisAiVersion,
		},
		{
			ryzenAiVersion: "1.7.1",
			xdnaDriverTag: "2.21.75",
			xdnaDriverCommit: "beb9e450fe123ecdf395453971576179cedcf1dd",
			pythonVersion: "3.12",
			onnxRuntimeVitisAiVersion: "1.23.3",
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
		/current Ryzen AI Linux release supports STX and KRK/,
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

test("builds a service environment for the public AMD Linux wheels and XRT", () => {
	assert.deepEqual(
		buildAmdRyzenAiEnvironment("/home/test/.p/agent/indexing-service/venv", {
			LD_LIBRARY_PATH: "/custom/lib",
		}),
		{
			LD_LIBRARY_PATH:
				"/home/test/.p/agent/indexing-service/venv/lib/python3.12/site-packages/voe/lib:/opt/xilinx/xrt/lib:/lib/x86_64-linux-gnu:/custom/lib",
			RYZEN_AI_INSTALLATION_PATH: "/home/test/.p/agent/indexing-service/venv",
			XILINX_XRT: "/opt/xilinx/xrt",
		},
	);
	assert.deepEqual(buildAmdRyzenAiConfig("/home/test/.p/agent/indexing-service/venv"), {
		vitisaiCacheDirectory: "/home/test/.p/agent/indexing-service/vitisai-cache",
		vitisaiCacheKey: "Qwen_Qwen3-Embedding-0.6B-ryzen-ai-1.7.1",
		vitisaiConfigFile: undefined,
		vitisaiLogLevel: "error",
	});
});
