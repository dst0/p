import fs from "node:fs";

export function resolveIndexingDevicePlan(options = {}) {
	const platform = options.platform ?? process.platform;
	const architecture = options.architecture ?? process.arch;
	const hasAmd = options.hasLinuxAmdNpuHardware ?? false;
	const hasIntel = options.hasLinuxIntelNpuHardware ?? false;
	const amdFamily = options.amdNpuFamily ?? "ryzenai";
	const configuredDevice = options.requestedDevice ?? options.savedDevice;
	if (platform === "darwin" && architecture === "arm64") {
		const device = configuredDevice ?? "mps";
		if (["npu", "apple-ane"].includes(device)) {
			throw new Error(
				"Apple Neural Engine indexing is unavailable because no verified Qwen CoreML embedding artifact is installed; select GPU (MPS)",
			);
		}
		return {
			installAmdPhoenixIron: false,
			installAmdRyzenAi: false,
			installIntelOpenVino: false,
			ragDevice: device === "auto" ? "mps" : device,
		};
	}
	if (platform === "linux" && architecture === "x64") {
		const device = configuredDevice ?? (hasAmd || hasIntel ? "npu" : "cpu");
		if (device === "amd-phoenix-npu" || (["vitisai", "ryzenai"].includes(device) && amdFamily === "phoenix")) {
			return {
				installAmdPhoenixIron: true,
				installAmdRyzenAi: false,
				installIntelOpenVino: false,
				ragDevice: "amd-phoenix-npu",
			};
		}
		if (device === "amd-ryzenai-npu" || ["vitisai", "ryzenai"].includes(device)) {
			return {
				installAmdPhoenixIron: false,
				installAmdRyzenAi: true,
				installIntelOpenVino: false,
				ragDevice: "amd-ryzenai-npu",
			};
		}
		if (["intel-openvino-npu", "openvino-npu", "openvino"].includes(device)) {
			return {
				installAmdPhoenixIron: false,
				installAmdRyzenAi: false,
				installIntelOpenVino: true,
				ragDevice: "intel-openvino-npu",
			};
		}
		if (["npu", "auto"].includes(device)) {
			if (hasAmd && hasIntel) {
				throw new Error("Both AMD and Intel NPUs were detected; select ryzenai or intel-openvino-npu explicitly");
			}
			if (hasAmd) {
				return {
					installAmdPhoenixIron: amdFamily === "phoenix",
					installAmdRyzenAi: amdFamily !== "phoenix",
					installIntelOpenVino: false,
					ragDevice: amdFamily === "phoenix" ? "amd-phoenix-npu" : "amd-ryzenai-npu",
				};
			}
			if (hasIntel) {
				return {
					installAmdPhoenixIron: false,
					installAmdRyzenAi: false,
					installIntelOpenVino: true,
					ragDevice: "intel-openvino-npu",
				};
			}
			if (device === "npu") {
				throw new Error("NPU indexing was requested, but no supported AMD or Intel NPU was detected");
			}
		}
		return {
			installAmdPhoenixIron: false,
			installAmdRyzenAi: false,
			installIntelOpenVino: false,
			ragDevice: device === "auto" ? "cpu" : device,
		};
	}
	return {
		installAmdPhoenixIron: false,
		installAmdRyzenAi: false,
		installIntelOpenVino: false,
		ragDevice: configuredDevice ?? "cpu",
	};
}

export function resolveFallbackDeviceChoices(options = {}) {
	const platform = options.platform ?? process.platform;
	const architecture = options.architecture ?? process.arch;
	const hasAmd = options.hasAmdComputeDevice ?? fs.existsSync("/dev/kfd");
	const hasNvidia = options.hasNvidiaComputeDevice ?? fs.existsSync("/dev/nvidiactl");
	const excludedDevice = options.excludedDevice;
	const choices = [];
	if (platform === "darwin" && architecture === "arm64" && excludedDevice !== "mps") {
		choices.push({ device: "mps", label: "GPU (MPS) - Apple Silicon Metal" });
	}
	if (platform === "linux" && architecture === "x64") {
		if (hasAmd && excludedDevice !== "rocm") choices.push({ device: "rocm", label: "AMD GPU (ROCm)" });
		if (hasNvidia && excludedDevice !== "cuda") {
			choices.push({ device: "cuda", label: "NVIDIA GPU (CUDA)" });
		}
	}
	if (excludedDevice !== "cpu") choices.push({ device: "cpu", label: "CPU" });
	return choices;
}

export function selectTorchInstallPlan(options = {}) {
	const platform = options.platform ?? process.platform;
	const architecture = options.architecture ?? process.arch;
	const aliases = {
		"amd-rocm": "rocm",
		"apple-ane": "apple-ane",
		"apple-mps": "mps",
		"intel-openvino-cpu": "cpu",
		"intel-openvino-npu": "intel-openvino-npu",
		"nvidia-cuda": "cuda",
		"openvino-npu": "openvino-npu",
		"amd-phoenix-npu": "amd-phoenix-npu",
		"amd-ryzenai-npu": "amd-ryzenai-npu",
		ryzenai: "ryzenai",
		vitisai: "vitisai",
	};
	const configuredBackend = options.requestedBackend ?? "auto";
	const requested = aliases[configuredBackend] ?? configuredBackend;
	const valid = [
		"auto", "cpu", "rocm", "cuda", "mps", "npu", "apple-ane", "vitisai", "ryzenai", "openvino",
		"openvino-npu", "intel-openvino-npu", "amd-phoenix-npu", "amd-ryzenai-npu",
	];
	if (!valid.includes(requested)) {
		throw new Error(`torchBackend must be one of: ${valid.join(", ")}`);
	}
	const hasAmd = options.hasAmdComputeDevice ?? fs.existsSync("/dev/kfd");
	const hasNvidia = options.hasNvidiaComputeDevice ?? fs.existsSync("/dev/nvidiactl");
	let backend = requested;
	if (backend === "auto") {
		if (platform === "linux" && architecture === "x64" && hasAmd) backend = "rocm";
		else if (platform === "linux" && architecture === "x64" && hasNvidia) backend = "cuda";
		else if (platform === "darwin" && architecture === "arm64") backend = "mps";
		else if (platform === "linux") backend = "cpu";
		else backend = "default";
	}
	if (["mps", "npu", "apple-ane"].includes(backend)) backend = "default";
	if ([
		"vitisai", "ryzenai", "amd-phoenix-npu", "amd-ryzenai-npu", "openvino", "openvino-npu",
		"intel-openvino-npu",
	].includes(backend)) backend = "cpu";
	if (backend === "rocm" && (platform !== "linux" || architecture !== "x64")) {
		throw new Error("ROCm PyTorch is supported only on Linux x64");
	}
	if (backend === "cuda" && (platform !== "linux" || architecture !== "x64")) {
		throw new Error("Managed CUDA PyTorch is supported only on Linux x64");
	}
	if (platform === "darwin" && backend === "cpu") backend = "default";
	const indexUrls = {
		cpu: "https://download.pytorch.org/whl/cpu",
		rocm: "https://download.pytorch.org/whl/rocm7.2",
		cuda: "https://download.pytorch.org/whl/cu126",
	};
	return {
		backend,
		version: platform === "darwin" && architecture === "x64" ? "2.2.2" : "2.12.1",
		indexUrl: indexUrls[backend],
	};
}
