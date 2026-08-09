import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
	AMD_RYZEN_AI_MANIFEST,
	buildAmdRyzenAiConfig,
	buildAmdRyzenAiEnvironment,
	installAmdRyzenAiSystemRuntime,
} from "./install-amd-ryzen-ai.js";
import {
  AMD_PHOENIX_IRON_MANIFEST,
  buildAmdPhoenixIronConfig,
  buildAmdPhoenixIronEnvironment,
  installAmdPhoenixIronSystemRuntime,
} from "./install-amd-phoenix-iron.js";
import {
	INTEL_OPENVINO_NPU_MANIFEST,
	buildIntelOpenVinoConfig,
	installIntelOpenVinoNpuSystemRuntime,
} from "./install-intel-openvino-npu.js";
import { writeCodeRagConfig } from "./indexing-config.js";
import { resolveFallbackDeviceChoices, resolveIndexingDevicePlan } from "./indexing-install-plans.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const AGENT_DIR = process.env.P_CODING_AGENT_DIR ?? path.join(os.homedir(), ".p", "agent");
const VENV_DIR = path.join(AGENT_DIR, "indexing-service", "venv");
const LOG_DIR = path.join(AGENT_DIR, "indexing-service", "logs");
const QDRANT_DATA_DIR = path.join(AGENT_DIR, "code-rag", "qdrant");
const DAEMON = path.join(ROOT, "packages", "coding-agent", "dist", "indexing-service-daemon.js");
const DRY_RUN = process.argv.includes("--dry-run");

export function installSelectedNpuSystemRuntime(devicePlan) {
	if (devicePlan.installAmdPhoenixIron) {
		console.log(
			`AMD Phoenix/Hawk Point NPU selected; installing MLIR-AIE ${AMD_PHOENIX_IRON_MANIFEST.mlirAieVersion}`,
		);
		installAmdPhoenixIronSystemRuntime({ agentDirectory: AGENT_DIR, dryRun: DRY_RUN });
	}
	if (devicePlan.installAmdRyzenAi) {
		console.log(`AMD XDNA NPU selected; installing Ryzen AI ${AMD_RYZEN_AI_MANIFEST.ryzenAiVersion}`);
		installAmdRyzenAiSystemRuntime({ agentDirectory: AGENT_DIR, dryRun: DRY_RUN });
	}
	if (devicePlan.installIntelOpenVino) {
		console.log(
			`Intel NPU selected; installing driver ${INTEL_OPENVINO_NPU_MANIFEST.driverVersion} `
			+ `and OpenVINO ${INTEL_OPENVINO_NPU_MANIFEST.openVinoVersion}`,
		);
		installIntelOpenVinoNpuSystemRuntime({ agentDirectory: AGENT_DIR, dryRun: DRY_RUN });
	}
}

export async function promptForDeviceFallback(error, failedDevice, planOptions) {
	if (DRY_RUN || !process.stdin.isTTY || !process.stdout.isTTY || !isAcceleratedDevice(failedDevice)) throw error;
	const choices = resolveFallbackDeviceChoices({
		...planOptions,
		excludedDevice: canonicalAcceleratorDevice(failedDevice),
	});
	if (choices.length === 0) throw error;
	console.error(`Indexing accelerator '${failedDevice}' is unavailable: ${errorMessage(error)}`);
	console.log("Choose a detected, supported fallback for code indexing:");
	for (const [index, choice] of choices.entries()) console.log(`  ${index + 1}) ${choice.label}`);
	const readline = createInterface({ input: process.stdin, output: process.stdout });
	let selected;
	try {
		while (!selected) {
			const answer = (await readline.question(`Choose [1-${choices.length}] (default: 1): `)).trim() || "1";
			const index = Number(answer) - 1;
			if (Number.isInteger(index) && index >= 0 && index < choices.length) selected = choices[index];
			else console.log(`Invalid choice, enter a number between 1 and ${choices.length}.`);
		}
	} finally {
		readline.close();
	}
	writeCodeRagConfig(AGENT_DIR, { embeddingDevice: selected.device, torchBackend: "auto" });
	console.log(`Using embedding fallback: ${selected.device}`);
	return resolveIndexingDevicePlan({ ...planOptions, requestedDevice: selected.device });
}

export function buildManagedIndexingConfig(currentConfig, devicePlan, torchPlan, venvPython, qdrantBinary) {
	const ragDevice = devicePlan.ragDevice;
	return {
		...currentConfig,
		...(
			devicePlan.installAppleCoreAi || devicePlan.installAmdPhoenixIron
				|| devicePlan.installAmdRyzenAi || devicePlan.installIntelOpenVino
				? {
					embeddingStartupTimeoutMs: Math.max(currentConfig.embeddingStartupTimeoutMs ?? 0, 600_000),
					embeddingTimeoutMs: Math.max(currentConfig.embeddingTimeoutMs ?? 0, 600_000),
					searchTimeoutMs: Math.max(currentConfig.searchTimeoutMs ?? 0, 600_000),
				}
				: {}
		),
		...(devicePlan.installAmdPhoenixIron ? buildAmdPhoenixIronConfig(AGENT_DIR, currentConfig) : {}),
		...(devicePlan.installAmdRyzenAi ? buildAmdRyzenAiConfig(VENV_DIR, currentConfig) : {}),
		...(devicePlan.installIntelOpenVino ? buildIntelOpenVinoConfig(AGENT_DIR, currentConfig) : {}),
		embeddingDevice: ragDevice,
		pythonExecutable: venvPython,
		qdrantBinary,
		qdrantDataDirectory: QDRANT_DATA_DIR,
		torchBackend: torchPlan.backend === "default" ? "auto" : torchPlan.backend,
	};
}

export function buildServiceValues(devicePlan, venvPython) {
	const ragDevice = devicePlan.ragDevice;
	const environment = {
		...(devicePlan.installAmdPhoenixIron ? buildAmdPhoenixIronEnvironment(VENV_DIR) : {}),
		...(devicePlan.installAmdRyzenAi ? buildAmdRyzenAiEnvironment(VENV_DIR) : {}),
		P_CODING_AGENT_DIR: AGENT_DIR,
		PATH: `${path.dirname(venvPython)}:${process.env.PATH ?? ""}`,
		...(ragDevice === "cpu"
			? { CUDA_VISIBLE_DEVICES: "99", HIP_VISIBLE_DEVICES: "99", ROCR_VISIBLE_DEVICES: "99" }
			: {}),
	};
	return {
		node: process.execPath,
		daemon: DAEMON,
		root: ROOT,
		environment,
		stdout: path.join(LOG_DIR, "service.log"),
		stderr: path.join(LOG_DIR, "service-error.log"),
	};
}

export function isTorchAcceleratorDevice(device) {
	return ["amd-rocm", "apple-mps", "cuda", "mps", "nvidia-cuda", "rocm"].includes(device);
}

function isAcceleratedDevice(device) {
	return [
		"amd-rocm", "apple-ane", "apple-mps", "cuda", "intel-openvino-npu", "mps", "npu", "nvidia-cuda",
		"openvino", "openvino-npu", "rocm", "ryzenai", "vitisai", "amd-phoenix-npu", "amd-ryzenai-npu",
	].includes(device);
}

function canonicalAcceleratorDevice(device) {
	if (["amd-rocm", "rocm"].includes(device)) return "rocm";
	if (["cuda", "nvidia-cuda"].includes(device)) return "cuda";
	if (device === "apple-ane") return "apple-ane";
	if (["apple-mps", "mps"].includes(device)) return "mps";
	return device;
}

function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
