import fs from "node:fs";

export function resolveIndexingDevicePlan(options = {}) {
	const platform = options.platform ?? process.platform;
	const architecture = options.architecture ?? process.arch;
	const hasAmd = options.hasLinuxAmdNpuHardware ?? false;
	const hasIntel = options.hasLinuxIntelNpuHardware ?? false;
	const configuredDevice = options.requestedDevice ?? options.savedDevice;
	if (platform === "darwin" && architecture === "arm64") {
		const device = configuredDevice ?? "npu";
		return {
			installAmdRyzenAi: false,
			installIntelOpenVino: false,
			ragDevice: ["auto", "npu", "apple-ane"].includes(device) ? "mps" : device,
		};
	}
	if (platform === "linux" && architecture === "x64") {
		const device = configuredDevice ?? (hasAmd || hasIntel ? "npu" : "cpu");
		if (["vitisai", "ryzenai"].includes(device)) {
			return { installAmdRyzenAi: true, installIntelOpenVino: false, ragDevice: "ryzenai" };
		}
		if (["intel-openvino-npu", "openvino-npu", "openvino"].includes(device)) {
			return { installAmdRyzenAi: false, installIntelOpenVino: true, ragDevice: "intel-openvino-npu" };
		}
		if (["npu", "auto"].includes(device)) {
			if (hasAmd && hasIntel) {
				throw new Error("Both AMD and Intel NPUs were detected; select ryzenai or intel-openvino-npu explicitly");
			}
			if (hasAmd) return { installAmdRyzenAi: true, installIntelOpenVino: false, ragDevice: "ryzenai" };
			if (hasIntel) {
				return { installAmdRyzenAi: false, installIntelOpenVino: true, ragDevice: "intel-openvino-npu" };
			}
			if (device === "npu") {
				throw new Error("NPU indexing was requested, but no supported AMD or Intel NPU was detected");
			}
		}
		return {
			installAmdRyzenAi: false,
			installIntelOpenVino: false,
			ragDevice: device === "auto" ? "cpu" : device,
		};
	}
	return {
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
		choices.push({ device: "mps", label: "Apple MPS GPU" });
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
	const configuredDevice = process.env.P_CODE_RAG_DEVICE;
	const aliases = {
		"amd-rocm": "rocm",
		"apple-ane": "apple-ane",
		"apple-mps": "mps",
		"intel-openvino-cpu": "cpu",
		"intel-openvino-npu": "intel-openvino-npu",
		"nvidia-cuda": "cuda",
		"openvino-npu": "openvino-npu",
		ryzenai: "ryzenai",
		vitisai: "vitisai",
	};
	const requested = options.requestedBackend
		?? process.env.P_CODE_RAG_TORCH_BACKEND
		?? (configuredDevice ? (aliases[configuredDevice] ?? configuredDevice) : "auto");
	const valid = [
		"auto", "cpu", "rocm", "cuda", "mps", "npu", "apple-ane", "vitisai", "ryzenai", "openvino",
		"openvino-npu", "intel-openvino-npu",
	];
	if (!valid.includes(requested)) {
		throw new Error(`P_CODE_RAG_TORCH_BACKEND must be one of: ${valid.join(", ")}`);
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
	if (["vitisai", "ryzenai", "openvino", "openvino-npu", "intel-openvino-npu"].includes(backend)) backend = "cpu";
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

export function collectResourceEnvironment(source = process.env) {
	const environment = {};
	for (const key of [
		"P_CODE_RAG_DEVICE",
		"P_CODE_RAG_MAX_CPU_THREADS",
		"P_CODE_RAG_MAX_EMBED_BATCH_SIZE",
		"P_CODE_RAG_MAX_SEQUENCE_LENGTH",
		"P_CODE_RAG_MIN_ACCELERATOR_MEMORY_RESERVE_MB",
		"P_CODE_RAG_MIN_SYSTEM_MEMORY_RESERVE_MB",
		"P_CODE_RAG_MODEL_PARAMETER_COUNT",
		"P_CODE_RAG_PREPARATION_MAX_WORKERS",
		"P_CODE_RAG_PREPARATION_WORKER_MEMORY_MB",
		"P_CODE_RAG_PREPARATION_MEMORY_RESERVE_MB",
		"P_CODE_RAG_VITISAI_CACHE_DIR",
		"P_CODE_RAG_VITISAI_CACHE_KEY",
		"P_CODE_RAG_VITISAI_CONFIG_FILE",
		"P_CODE_RAG_VITISAI_LOG_LEVEL",
		"P_CODE_RAG_OPENVINO_CACHE_DIR",
	]) {
		if (source[key] !== undefined) environment[key] = source[key];
	}
	return environment;
}
