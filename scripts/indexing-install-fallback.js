import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
	AMD_RYZEN_AI_MANIFEST,
	buildAmdRyzenAiEnvironment,
	installAmdRyzenAiSystemRuntime,
} from "./install-amd-ryzen-ai.js";
import {
	INTEL_OPENVINO_NPU_MANIFEST,
	buildIntelOpenVinoEnvironment,
	installIntelOpenVinoNpuSystemRuntime,
} from "./install-intel-openvino-npu.js";
import {
	collectResourceEnvironment,
	resolveFallbackDeviceChoices,
	resolveIndexingDevicePlan,
} from "./indexing-install-plans.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const AGENT_DIR = process.env.P_CODING_AGENT_DIR ?? path.join(os.homedir(), ".p", "agent");
const VENV_DIR = path.join(AGENT_DIR, "indexing-service", "venv");
const LOG_DIR = path.join(AGENT_DIR, "indexing-service", "logs");
const QDRANT_DATA_DIR = path.join(AGENT_DIR, "code-rag", "qdrant");
const DAEMON = path.join(ROOT, "packages", "coding-agent", "dist", "indexing-service-daemon.js");
const DRY_RUN = process.argv.includes("--dry-run");

export function installSelectedNpuSystemRuntime(devicePlan) {
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
	fs.mkdirSync(AGENT_DIR, { recursive: true, mode: 0o700 });
	fs.writeFileSync(path.join(AGENT_DIR, "indexing-device"), `${selected.device}\n`, { mode: 0o600 });
	delete process.env.P_CODE_RAG_TORCH_BACKEND;
	for (const key of [
		"P_CODE_RAG_OPENVINO_CACHE_DIR",
		"P_CODE_RAG_VITISAI_CACHE_DIR",
		"P_CODE_RAG_VITISAI_CACHE_KEY",
		"P_CODE_RAG_VITISAI_CONFIG_FILE",
		"P_CODE_RAG_VITISAI_LOG_LEVEL",
	]) {
		delete process.env[key];
	}
	process.env.P_CODE_RAG_DEVICE = selected.device;
	console.log(`Using embedding fallback: ${selected.device}`);
	return resolveIndexingDevicePlan({ ...planOptions, requestedDevice: selected.device });
}

export function buildServiceValues(devicePlan, torchPlan, venvPython, qdrantBinary) {
	const ragDevice = devicePlan.ragDevice;
	const environment = {
		...collectResourceEnvironment(),
		...(devicePlan.installAmdRyzenAi ? buildAmdRyzenAiEnvironment(VENV_DIR) : {}),
		...(devicePlan.installIntelOpenVino ? buildIntelOpenVinoEnvironment(AGENT_DIR) : {}),
		P_CODING_AGENT_DIR: AGENT_DIR,
		P_CODE_RAG_PYTHON: venvPython,
		P_CODE_RAG_QDRANT_BINARY: qdrantBinary,
		P_CODE_RAG_QDRANT_DATA_DIR: QDRANT_DATA_DIR,
		P_CODE_RAG_EXPECTED_BACKEND: devicePlan.installAmdRyzenAi
			? "vitisai"
			: devicePlan.installIntelOpenVino
				? "openvino"
				: torchPlan.backend,
		P_CODE_RAG_DEVICE: ragDevice,
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
		"openvino", "openvino-npu", "rocm", "ryzenai", "vitisai",
	].includes(device);
}

function canonicalAcceleratorDevice(device) {
	if (["amd-rocm", "rocm"].includes(device)) return "rocm";
	if (["cuda", "nvidia-cuda"].includes(device)) return "cuda";
	if (["apple-ane", "apple-mps", "mps"].includes(device)) return "mps";
	return device;
}

function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
