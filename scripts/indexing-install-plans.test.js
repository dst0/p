import assert from "node:assert/strict";
import test from "node:test";

import {
	resolveFallbackDeviceChoices,
	resolveIndexingDevicePlan,
} from "./indexing-install-plans.js";

test("prioritizes Core AI on current macOS and preserves the legacy CoreML path", () => {
	for (const requestedDevice of [undefined, "auto", "npu", "apple-ane"]) {
		assert.deepEqual(
			resolveIndexingDevicePlan({
				platform: "darwin",
				architecture: "arm64",
				hasMacOsCoreAi: true,
				requestedDevice,
			}),
			{
				installAppleCoreAi: true,
				installAmdPhoenixIron: false,
				installAmdRyzenAi: false,
				installIntelOpenVino: false,
				ragDevice: "apple-ane",
			},
		);
	}
	assert.deepEqual(
		resolveIndexingDevicePlan({
			platform: "darwin",
			architecture: "arm64",
			hasMacOsCoreAi: false,
			requestedDevice: "apple-ane",
		}),
		{
			installAppleCoreAi: false,
			installAmdPhoenixIron: false,
			installAmdRyzenAi: false,
			installIntelOpenVino: false,
			ragDevice: "apple-ane",
		},
	);
	assert.equal(resolveIndexingDevicePlan({
		platform: "darwin",
		architecture: "arm64",
		hasMacOsCoreAi: false,
	}).ragDevice, "mps");
});

test("resolves Linux AMD NPU aliases to the Ryzen AI installer", () => {
	for (const requestedDevice of [undefined, "auto", "npu", "vitisai", "ryzenai"]) {
		assert.deepEqual(
			resolveIndexingDevicePlan({
				platform: "linux",
				architecture: "x64",
				hasLinuxAmdNpuHardware: true,
				requestedDevice,
			}),
			{
				installAmdPhoenixIron: false,
				installAmdRyzenAi: true,
				installIntelOpenVino: false,
				ragDevice: "amd-ryzenai-npu",
			},
		);
	}
	assert.deepEqual(
		resolveIndexingDevicePlan({
			platform: "linux",
			architecture: "x64",
			hasLinuxAmdNpuHardware: true,
			requestedDevice: "cpu",
		}),
		{
			installAmdPhoenixIron: false,
			installAmdRyzenAi: false,
			installIntelOpenVino: false,
			ragDevice: "cpu",
		},
	);
});

test("resolves Linux Intel NPU aliases to the OpenVINO installer", () => {
	for (const requestedDevice of [
		undefined,
		"auto",
		"npu",
		"openvino",
		"openvino-npu",
		"intel-openvino-npu",
	]) {
		assert.deepEqual(
			resolveIndexingDevicePlan({
				platform: "linux",
				architecture: "x64",
				hasLinuxIntelNpuHardware: true,
				requestedDevice,
			}),
			{
				installAmdPhoenixIron: false,
				installAmdRyzenAi: false,
				installIntelOpenVino: true,
				ragDevice: "intel-openvino-npu",
			},
		);
	}
});

test("requires an explicit NPU vendor when both vendors are present", () => {
	assert.throws(
		() =>
			resolveIndexingDevicePlan({
				platform: "linux",
				architecture: "x64",
				hasLinuxAmdNpuHardware: true,
				hasLinuxIntelNpuHardware: true,
				requestedDevice: "npu",
			}),
		/select ryzenai or intel-openvino-npu explicitly/,
	);
	assert.equal(
		resolveIndexingDevicePlan({
			platform: "linux",
			architecture: "x64",
			hasLinuxAmdNpuHardware: true,
			hasLinuxIntelNpuHardware: true,
			requestedDevice: "intel-openvino-npu",
		}).ragDevice,
		"intel-openvino-npu",
	);
});

test("does not invent an AMD NPU on ordinary Linux hosts", () => {
	assert.deepEqual(
		resolveIndexingDevicePlan({
			platform: "linux",
			architecture: "x64",
			hasLinuxAmdNpuHardware: false,
		}),
		{
			installAmdPhoenixIron: false,
			installAmdRyzenAi: false,
			installIntelOpenVino: false,
			ragDevice: "cpu",
		},
	);
});

test("resolves Phoenix and Hawk Point hardware to the MLIR-AIE installer", () => {
	for (const requestedDevice of [undefined, "auto", "npu", "ryzenai", "amd-phoenix-npu"]) {
		assert.deepEqual(
			resolveIndexingDevicePlan({
				amdNpuFamily: "phoenix",
				architecture: "x64",
				hasLinuxAmdNpuHardware: true,
				platform: "linux",
				requestedDevice,
			}),
			{
				installAmdPhoenixIron: true,
				installAmdRyzenAi: false,
				installIntelOpenVino: false,
				ragDevice: "amd-phoenix-npu",
			},
		);
	}
});

test("offers only detected Linux GPU and CPU fallbacks", () => {
	assert.deepEqual(
		resolveFallbackDeviceChoices({
			architecture: "x64",
			hasAmdComputeDevice: true,
			hasNvidiaComputeDevice: false,
			platform: "linux",
		}),
		[
			{ device: "rocm", label: "AMD GPU (ROCm)" },
			{ device: "cpu", label: "CPU" },
		],
	);
	assert.deepEqual(
		resolveFallbackDeviceChoices({
			architecture: "x64",
			excludedDevice: "cuda",
			hasAmdComputeDevice: false,
			hasNvidiaComputeDevice: true,
			platform: "linux",
		}),
		[{ device: "cpu", label: "CPU" }],
	);
});

test("keeps Apple NPU, GPU (MPS), and CPU as supported Mac choices", () => {
	assert.deepEqual(resolveFallbackDeviceChoices({
		architecture: "arm64",
		hasMacOsCoreAi: true,
		platform: "darwin",
	}), [
		{ device: "apple-ane", label: "NPU (Apple Neural Engine - Core AI, full ANE)" },
		{ device: "mps", label: "GPU (MPS) - Apple Silicon Metal" },
		{ device: "cpu", label: "CPU" },
	]);
});
