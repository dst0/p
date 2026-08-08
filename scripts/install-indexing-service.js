#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const CODE_INDEX_DIR = path.join(ROOT, "packages", "code-index");
const DAEMON = path.join(ROOT, "packages", "coding-agent", "dist", "indexing-service-daemon.js");
const SMOKE_SCRIPT = path.join(SCRIPT_DIR, "smoke-code-index.js");
const REQUIREMENTS = path.join(CODE_INDEX_DIR, "requirements.txt");
const AGENT_DIR = process.env.P_CODING_AGENT_DIR ?? path.join(os.homedir(), ".p", "agent");
const SERVICE_ROOT = path.join(AGENT_DIR, "indexing-service");
const BIN_DIR = path.join(SERVICE_ROOT, "bin");
const VENV_DIR = path.join(SERVICE_ROOT, "venv");
const QDRANT_DATA_DIR = path.join(AGENT_DIR, "code-rag", "qdrant");
const QDRANT_CONFIG_PATH = path.join(QDRANT_DATA_DIR, "config.yaml");
const EMBEDDING_SCRIPT = path.join(CODE_INDEX_DIR, "embedding_server.py");
const EMBEDDING_PORT = 18742;
const LOG_DIR = path.join(SERVICE_ROOT, "logs");
const STATUS_PATH = path.join(AGENT_DIR, "indexing-service-status.json");
const VERSION_UNCHANGED_FLAG_PATH = path.join(AGENT_DIR, "indexing-version-unchanged");
const SERVICE_LABEL = "com.dst.p.code-index";
const LEGACY_SERVICE_LABEL = "com.dst.p.code-index-embedding";
const QDRANT_VERSION = "1.18.3";
const TORCH_VERSION = "2.12.1";
const DRY_RUN = process.argv.includes("--dry-run");

const QDRANT_ASSETS = {
	"darwin-arm64": {
		name: "qdrant-aarch64-apple-darwin.tar.gz",
		sha256: "0cb040a261035c316779bd7b4cca2e6ab39faf62640d6918bbbe320e2a9a6547",
	},
	"darwin-x64": {
		name: "qdrant-x86_64-apple-darwin.tar.gz",
		sha256: "45bdd4642e7f25611e9cd74f9f91482b27c5376840cd8dc476da67b87abe25a6",
	},
	"linux-arm64": {
		name: "qdrant-aarch64-unknown-linux-musl.tar.gz",
		sha256: "1e738b45f90935c383b4076c30f377f390964cb5962b5bff24439812d157dc24",
	},
	"linux-x64": {
		name: "qdrant-x86_64-unknown-linux-musl.tar.gz",
		sha256: "b4faedcdf8c9577bf1c8f2ab9b454636b87e056c116c99d49bd4f9fb2e634285",
	},
};

export function getQdrantAsset(platform = process.platform, architecture = process.arch) {
	return QDRANT_ASSETS[`${platform}-${architecture}`];
}

export function selectTorchInstallPlan(options = {}) {
	const platform = options.platform ?? process.platform;
	const architecture = options.architecture ?? process.arch;
	const requestedBackend =
		options.requestedBackend ??
		process.env.P_CODE_RAG_TORCH_BACKEND ??
		(process.env.P_CODE_RAG_DEVICE === "cpu"
			? "cpu"
			: process.env.P_CODE_RAG_DEVICE === "mps"
				? "mps"
				: process.env.P_CODE_RAG_DEVICE === "npu"
					? "npu"
					: "auto");
	const hasAmdComputeDevice = options.hasAmdComputeDevice ?? fs.existsSync("/dev/kfd");
	const hasNvidiaComputeDevice = options.hasNvidiaComputeDevice ?? fs.existsSync("/dev/nvidiactl");
	if (!["auto", "cpu", "rocm", "cuda", "mps", "npu"].includes(requestedBackend)) {
		throw new Error("P_CODE_RAG_TORCH_BACKEND must be one of: auto, cpu, rocm, cuda, mps, npu");
	}

	let backend = requestedBackend;
	if (backend === "auto") {
		if (platform === "linux" && architecture === "x64" && hasAmdComputeDevice) backend = "rocm";
		else if (platform === "linux" && architecture === "x64" && hasNvidiaComputeDevice) backend = "cuda";
		else if (platform === "darwin" && architecture === "arm64") backend = "mps";
		else if (platform === "linux") backend = "cpu";
		else backend = "default";
	}
	if (backend === "mps" || backend === "npu") {
		backend = "default";
	}
	if (backend === "rocm" && (platform !== "linux" || architecture !== "x64")) {
		throw new Error("ROCm PyTorch is supported only on Linux x64");
	}
	if (backend === "cuda" && (platform !== "linux" || architecture !== "x64")) {
		throw new Error("Managed CUDA PyTorch is supported only on Linux x64");
	}
	if (platform === "darwin" && backend === "cpu") {
		backend = "default";
	}

	const indexUrls = {
		cpu: "https://download.pytorch.org/whl/cpu",
		rocm: "https://download.pytorch.org/whl/rocm7.2",
		cuda: "https://download.pytorch.org/whl/cu126",
	};
	return {
		backend,
		version: platform === "darwin" && architecture === "x64" ? "2.2.2" : TORCH_VERSION,
		indexUrl: indexUrls[backend],
	};
}

export function getQdrantExtractionArgs(archive, destination) {
	return ["-xzf", archive, "--no-same-owner", "-C", destination];
}

export function getSystemdUserUnitDirectory(
	configHome = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"),
) {
	return path.join(configHome, "systemd", "user");
}

export function isIndexingDaemonCommand(command, daemonPath = "indexing-service-daemon.js") {
	const executable = command.trim().split(/\s+/, 1)[0];
	if (!/^node(?:js)?(?:\.exe)?$/.test(path.basename(executable))) return false;
	const daemonOffset = command.indexOf(daemonPath);
	if (daemonOffset < 0) return false;
	const suffix = command.slice(daemonOffset + daemonPath.length);
	return suffix.length === 0 || /^\s/.test(suffix);
}

export function selectIndexingDaemonPids(processTable, options) {
	const selected = new Set();
	for (const line of processTable.split("\n")) {
		const match = /^\s*(\d+)\s+(.+)$/.exec(line);
		if (!match) continue;
		const pid = Number(match[1]);
		const command = match[2];
		if (!Number.isSafeInteger(pid) || !isIndexingDaemonCommand(command)) continue;
		const workingDirectory = options.cwdForPid(pid);
		if (pid === options.statusPid || command.includes(options.daemonPath) || workingDirectory === options.rootPath) {
			selected.add(pid);
		}
	}
	return [...selected];
}

export function isManagedBackendCommand(command, options) {
	return (
		hasArgumentSequence(command, [options.qdrantBinary, "--config-path", options.qdrantConfigPath]) ||
		hasArgumentSequence(command, [options.embeddingScript, "--port", String(options.embeddingPort)])
	);
}

export function selectManagedBackendPids(processTable, options) {
	const selected = new Set();
	for (const line of processTable.split("\n")) {
		const match = /^\s*(\d+)\s+(.+)$/.exec(line);
		if (!match) continue;
		const pid = Number(match[1]);
		if (Number.isSafeInteger(pid) && isManagedBackendCommand(match[2], options)) selected.add(pid);
	}
	return [...selected];
}

export function renderLaunchdPlist(values) {
	const environment = Object.entries(values.environment)
		.map(([key, value]) => `        <key>${escapeXml(key)}</key>\n        <string>${escapeXml(value)}</string>`)
		.join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${SERVICE_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${escapeXml(values.node)}</string>
        <string>${escapeXml(values.daemon)}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${escapeXml(values.root)}</string>
    <key>EnvironmentVariables</key>
    <dict>
${environment}
    </dict>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${escapeXml(values.stdout)}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(values.stderr)}</string>
</dict>
</plist>
`;
}

export function renderSystemdUnit(values) {
	const environment = Object.entries(values.environment)
		.map(([key, value]) => `Environment="${escapeSystemd(`${key}=${value}`)}"`)
		.join("\n");
	return `[Unit]
Description=P code indexing service
After=network.target

[Service]
Type=simple
ExecStart="${escapeSystemd(values.node)}" "${escapeSystemd(values.daemon)}"
WorkingDirectory=${escapeSystemdPath(values.root)}
${environment}
Restart=always
RestartSec=3
StandardOutput=append:${escapeSystemdPath(values.stdout)}
StandardError=append:${escapeSystemdPath(values.stderr)}

[Install]
WantedBy=default.target
`;
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
	]) {
		if (source[key] !== undefined) environment[key] = source[key];
	}
	return environment;
}

function readSavedSetting(fileName) {
	try {
		const filePath = path.join(AGENT_DIR, fileName);
		if (!fs.existsSync(filePath)) return undefined;
		const value = fs.readFileSync(filePath, "utf-8").trim();
		return value || undefined;
	} catch {
		return undefined;
	}
}

async function main() {
	if (!getQdrantAsset()) {
		throw new Error(`Code indexing service is not supported on ${process.platform}/${process.arch}`);
	}
	const hasLinuxAmdNpuDevice = linuxAmdNpuHardwarePresent();
	const defaultDevice = process.platform === "darwin" && process.arch === "arm64" ? "npu" : "cpu";
	const savedDevice = readSavedSetting("indexing-device");
	const savedDeviceUnsupported = process.platform === "linux" && savedDevice === "npu";
	if (savedDeviceUnsupported) {
		console.log("Saved Linux NPU indexing selection is no longer accepted; using CPU until Ryzen AI is explicitly configured.");
	}
	const requestedDevice = process.env.P_CODE_RAG_DEVICE;
	const ragDevice = requestedDevice ?? (savedDeviceUnsupported ? "cpu" : savedDevice) ?? defaultDevice;
	process.env.P_CODE_RAG_DEVICE = ragDevice;
	if (requestedDevice === "npu" && process.platform === "linux") {
		const message = linuxNpuUnsupportedMessage(hasLinuxAmdNpuDevice);
		if (DRY_RUN) console.log(message);
		else throw new Error(message);
	} else if (hasLinuxAmdNpuDevice && ragDevice === "cpu") {
		console.log("AMD XDNA NPU hardware detected; using CPU indexing until a validated Ryzen AI runtime is configured.");
	}

	const savedBatchSize = readSavedSetting("indexing-max-batch-size");
	if (!process.env.P_CODE_RAG_MAX_EMBED_BATCH_SIZE && savedBatchSize) {
		process.env.P_CODE_RAG_MAX_EMBED_BATCH_SIZE = savedBatchSize;
	}

	const python = findCompatiblePython({ allowInstall: !DRY_RUN });
	const torchPlan = selectTorchInstallPlan();
	const venvPython = path.join(VENV_DIR, "bin", "python");
	const qdrantBinary = path.join(BIN_DIR, "qdrant");
	const environment = {
		P_CODING_AGENT_DIR: AGENT_DIR,
		P_CODE_RAG_PYTHON: venvPython,
		P_CODE_RAG_QDRANT_BINARY: qdrantBinary,
		P_CODE_RAG_QDRANT_DATA_DIR: QDRANT_DATA_DIR,
		P_CODE_RAG_EXPECTED_BACKEND: torchPlan.backend,
		P_CODE_RAG_DEVICE: ragDevice,
		...(ragDevice === "cpu"
			? {
					CUDA_VISIBLE_DEVICES: "99",
					HIP_VISIBLE_DEVICES: "99",
					ROCR_VISIBLE_DEVICES: "99",
				}
			: {}),
		...collectResourceEnvironment(),
	};
	const values = {
		node: process.execPath,
		daemon: DAEMON,
		root: ROOT,
		environment,
		stdout: path.join(LOG_DIR, "service.log"),
		stderr: path.join(LOG_DIR, "service-error.log"),
	};

	if (DRY_RUN) {
		if (process.platform === "darwin") renderLaunchdPlist(values);
		else renderSystemdUnit(values);
		console.log(
			`Indexing service installation validated for ${process.platform}/${process.arch} `
			+ `with ${python} and PyTorch backend ${torchPlan.backend}`,
		);
		return;
	}

	if (!fs.existsSync(DAEMON)) throw new Error(`Built indexing daemon not found: ${DAEMON}`);
	fs.mkdirSync(BIN_DIR, { recursive: true, mode: 0o700 });
	fs.mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
	fs.mkdirSync(QDRANT_DATA_DIR, { recursive: true, mode: 0o700 });
	await installQdrant(qdrantBinary);
	installPythonEnvironment(python, venvPython, torchPlan);
	mergeCodeRagConfig({
		qdrantBinary,
		qdrantDataDirectory: QDRANT_DATA_DIR,
		pythonExecutable: venvPython,
	});

	if (process.platform === "darwin") await installDarwin(renderLaunchdPlist(values));
	else await installLinux(renderSystemdUnit(values));
	console.log(`Code indexing service installed (${SERVICE_LABEL})`);
}

async function installQdrant(qdrantBinary) {
	if (fs.existsSync(qdrantBinary)) {
		const version = capture(qdrantBinary, ["--version"], { allowFailure: true });
		if (version.includes(QDRANT_VERSION)) return;
	}
	const asset = getQdrantAsset();
	const url = `https://github.com/qdrant/qdrant/releases/download/v${QDRANT_VERSION}/${asset.name}`;
	const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "p-qdrant-"));
	const archive = path.join(temporaryDirectory, asset.name);
	try {
		console.log(`Downloading Qdrant ${QDRANT_VERSION} for ${process.platform}/${process.arch}`);
		const response = await fetch(url, { redirect: "follow" });
		if (!response.ok) throw new Error(`Qdrant download failed with HTTP ${response.status}`);
		const bytes = Buffer.from(await response.arrayBuffer());
		const digest = createHash("sha256").update(bytes).digest("hex");
		if (digest !== asset.sha256) throw new Error(`Qdrant archive checksum mismatch for ${asset.name}`);
		fs.writeFileSync(archive, bytes, { mode: 0o600 });
		run("tar", getQdrantExtractionArgs(archive, BIN_DIR));
		fs.chmodSync(qdrantBinary, 0o755);
		const version = capture(qdrantBinary, ["--version"]);
		if (!version.includes(QDRANT_VERSION)) throw new Error(`Unexpected Qdrant version: ${version.trim()}`);
	} finally {
		fs.rmSync(temporaryDirectory, { recursive: true, force: true });
	}
}

function installPythonEnvironment(python, venvPython, torchPlan) {
	const requirements = fs.readFileSync(REQUIREMENTS, "utf-8");
	const markerPath = path.join(VENV_DIR, ".p-requirements");
	const marker = createHash("sha256")
		.update(`${python}\0${capture(python, ["--version"])}\0${requirements}\0${JSON.stringify(torchPlan)}`)
		.digest("hex");
	if (fs.existsSync(venvPython) && readFileIfPresent(markerPath) === marker) return;
	console.log(`Installing pinned code-index Python dependencies for ${torchPlan.backend}`);
	run(python, ["-m", "venv", VENV_DIR]);
	if (torchPlan.indexUrl) {
		run(venvPython, [
			"-m",
			"pip",
			"install",
			"--disable-pip-version-check",
			"--only-binary=:all:",
			"--force-reinstall",
			`torch==${torchPlan.version}`,
			"--index-url",
			torchPlan.indexUrl,
		]);
	}
	run(venvPython, [
		"-m",
		"pip",
		"install",
		"--disable-pip-version-check",
		"--only-binary=:all:",
		"--requirement",
		REQUIREMENTS,
	]);
	validateTorchInstallation(venvPython, torchPlan);
	fs.writeFileSync(markerPath, marker, { mode: 0o600 });
}

function validateTorchInstallation(venvPython, torchPlan) {
	const probe = JSON.parse(
		capture(venvPython, [
			"-c",
			[
				"import json, torch",
				"mps = getattr(torch.backends, 'mps', None)",
				"print(json.dumps({",
				"'version': torch.__version__,",
				"'cuda': getattr(torch.version, 'cuda', None),",
				"'hip': getattr(torch.version, 'hip', None),",
				"'accelerator_available': bool(torch.cuda.is_available() or (mps and mps.is_available()))",
				"}))",
			].join("\n"),
		]),
	);
	if (!String(probe.version).startsWith(torchPlan.version)) {
		throw new Error(`Expected PyTorch ${torchPlan.version}, installed ${probe.version}`);
	}
	if (torchPlan.backend === "rocm" && !probe.hip) {
		throw new Error("The installed PyTorch build does not include ROCm/HIP support");
	}
	if (torchPlan.backend === "cuda" && !probe.cuda) {
		throw new Error("The installed PyTorch build does not include CUDA support");
	}
	if (torchPlan.backend === "cpu" && (probe.hip || probe.cuda)) {
		throw new Error("The installed PyTorch build is not CPU-only");
	}
	console.log(
		`PyTorch ${probe.version} installed (${torchPlan.backend}); `
		+ `accelerator currently ${probe.accelerator_available ? "available" : "unavailable"}`,
	);
}

function mergeCodeRagConfig(defaults) {
	const configPath = path.join(AGENT_DIR, "code-rag.json");
	let config = {};
	if (fs.existsSync(configPath)) {
		config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
		if (typeof config !== "object" || config === null || Array.isArray(config)) {
			throw new Error(`Code RAG config must be a JSON object: ${configPath}`);
		}
	}
	let changed = false;
	for (const [key, value] of Object.entries(defaults)) {
		if (config[key] !== undefined) continue;
		config[key] = value;
		changed = true;
	}
	if (!changed && fs.existsSync(configPath)) return;
	fs.mkdirSync(AGENT_DIR, { recursive: true, mode: 0o700 });
	writeFileAtomic(configPath, `${JSON.stringify(config, undefined, 2)}\n`);
}

async function installDarwin(plist) {
	const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
	if (uid === undefined) throw new Error("Unable to determine the current user id for launchd");
	const versionUnchanged = fs.existsSync(VERSION_UNCHANGED_FLAG_PATH);
	if (versionUnchanged) fs.rmSync(VERSION_UNCHANGED_FLAG_PATH, { force: true });
	const knownDaemonPid = readStatusDaemonPid();
	const launchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
	const plistPath = path.join(launchAgentsDir, `${SERVICE_LABEL}.plist`);
	const legacyPlistPath = path.join(launchAgentsDir, `${LEGACY_SERVICE_LABEL}.plist`);
	fs.mkdirSync(launchAgentsDir, { recursive: true });
	if (versionUnchanged) {
		// Indexing version unchanged; update plist in place without restarting the daemon.
		// The running daemon will continue with the same binary.
		writeFileAtomic(plistPath, plist);
		run("launchctl", ["bootout", `gui/${uid}/${LEGACY_SERVICE_LABEL}`], { allowFailure: true });
		await waitForLaunchdRemoval(uid, LEGACY_SERVICE_LABEL);
		if (fs.existsSync(legacyPlistPath)) fs.rmSync(legacyPlistPath);
		console.log("Indexing version unchanged; skipped daemon restart.");
		return;
	}
	run("launchctl", ["bootout", `gui/${uid}/${LEGACY_SERVICE_LABEL}`], { allowFailure: true });
	await waitForLaunchdRemoval(uid, LEGACY_SERVICE_LABEL);
	if (fs.existsSync(legacyPlistPath)) fs.rmSync(legacyPlistPath);
	run("launchctl", ["bootout", `gui/${uid}/${SERVICE_LABEL}`], { allowFailure: true });
	await waitForLaunchdRemoval(uid, SERVICE_LABEL);
	await stopStaleDaemons(knownDaemonPid);
	await stopStaleBackends();
	writeFileAtomic(plistPath, plist);
	runRealSemanticSearchSmoke();
	run("launchctl", ["bootstrap", `gui/${uid}`, plistPath]);
	run("launchctl", ["kickstart", "-k", `gui/${uid}/${SERVICE_LABEL}`]);
}

async function waitForLaunchdRemoval(uid, label) {
	const target = `gui/${uid}/${label}`;
	const deadline = Date.now() + 10_000;
	while (run("launchctl", ["print", target], { allowFailure: true })) {
		if (Date.now() >= deadline) throw new Error(`Timed out waiting for launchd to remove ${label}`);
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}

async function installLinux(unit) {
	const versionUnchanged = fs.existsSync(VERSION_UNCHANGED_FLAG_PATH);
	if (versionUnchanged) fs.rmSync(VERSION_UNCHANGED_FLAG_PATH, { force: true });
	const knownDaemonPid = readStatusDaemonPid();
	const unitDirectory = getSystemdUserUnitDirectory();
	const unitPath = path.join(unitDirectory, `${SERVICE_LABEL}.service`);
	const legacyUnitPath = path.join(unitDirectory, `${LEGACY_SERVICE_LABEL}.service`);
	fs.mkdirSync(unitDirectory, { recursive: true });
	if (versionUnchanged) {
		// Indexing version unchanged; update unit file in place without restarting the daemon.
		writeFileAtomic(unitPath, unit);
		run("systemctl", ["--user", "disable", "--now", `${LEGACY_SERVICE_LABEL}.service`], { allowFailure: true });
		if (fs.existsSync(legacyUnitPath)) fs.rmSync(legacyUnitPath);
		run("systemctl", ["--user", "daemon-reload"]);
		console.log("Indexing version unchanged; skipped daemon restart.");
		return;
	}
	run("systemctl", ["--user", "disable", "--now", `${LEGACY_SERVICE_LABEL}.service`], { allowFailure: true });
	if (fs.existsSync(legacyUnitPath)) fs.rmSync(legacyUnitPath);
	run("systemctl", ["--user", "stop", `${SERVICE_LABEL}.service`], { allowFailure: true });
	await stopStaleDaemons(knownDaemonPid);
	await stopStaleBackends();
	writeFileAtomic(unitPath, unit);
	run("systemctl", ["--user", "daemon-reload"]);
	runRealSemanticSearchSmoke();
	run("systemctl", ["--user", "enable", "--now", `${SERVICE_LABEL}.service`]);
	run("systemctl", ["--user", "is-active", "--quiet", `${SERVICE_LABEL}.service`]);
}

async function stopStaleDaemons(statusPid) {
	const processTable = capture("ps", ["-axo", "pid=,command="], { allowFailure: true });
	const pids = selectIndexingDaemonPids(processTable, {
		daemonPath: DAEMON,
		rootPath: ROOT,
		statusPid,
		cwdForPid: getProcessWorkingDirectory,
	}).filter((pid) => pid !== process.pid);
	for (const pid of pids) await stopStaleDaemon(pid);
}

async function stopStaleDaemon(pid) {
	await stopValidatedProcess(pid, "stale code indexing daemon", isIndexingDaemonProcess);
}

async function stopStaleBackends() {
	const processTable = capture("ps", ["-axo", "pid=,command="], { allowFailure: true });
	const options = managedBackendOptions();
	const pids = selectManagedBackendPids(processTable, options).filter((pid) => pid !== process.pid);
	for (const pid of pids) {
		await stopValidatedProcess(pid, "stale code indexing backend", (candidate) =>
			isManagedBackendProcess(candidate, options),
		);
	}
}

async function stopValidatedProcess(pid, description, isExpectedProcess) {
	if (!isProcessRunning(pid) || !isExpectedProcess(pid)) return;
	console.log(`Stopping ${description} ${pid}`);
	try {
		process.kill(pid, "SIGTERM");
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
		return;
	}
	const deadline = Date.now() + 10_000;
	while (isProcessRunning(pid) && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	if (!isProcessRunning(pid)) return;
	if (!isExpectedProcess(pid)) {
		throw new Error(`Refusing to stop pid ${pid}: it is no longer the ${description}`);
	}
	process.kill(pid, "SIGKILL");
	const killDeadline = Date.now() + 5_000;
	while (isProcessRunning(pid) && Date.now() < killDeadline) {
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	if (isProcessRunning(pid)) throw new Error(`Timed out stopping ${description} ${pid}`);
}

function runRealSemanticSearchSmoke() {
	console.log("Running real semantic-search verification");
	run(process.execPath, [SMOKE_SCRIPT]);
}

function readStatusDaemonPid() {
	try {
		const status = JSON.parse(fs.readFileSync(STATUS_PATH, "utf-8"));
		return Number.isSafeInteger(status?.pid) && status.pid > 0 ? status.pid : undefined;
	} catch {
		return undefined;
	}
}

function isIndexingDaemonProcess(pid) {
	return isIndexingDaemonCommand(capture("ps", ["-p", String(pid), "-o", "command="], { allowFailure: true }));
}

function isManagedBackendProcess(pid, options) {
	return isManagedBackendCommand(
		capture("ps", ["-p", String(pid), "-o", "command="], { allowFailure: true }),
		options,
	);
}

function managedBackendOptions() {
	return {
		qdrantBinary: path.join(BIN_DIR, "qdrant"),
		qdrantConfigPath: QDRANT_CONFIG_PATH,
		embeddingScript: EMBEDDING_SCRIPT,
		embeddingPort: EMBEDDING_PORT,
	};
}

function getProcessWorkingDirectory(pid) {
	if (process.platform === "linux") {
		return capture("readlink", [`/proc/${pid}/cwd`], { allowFailure: true }).trim() || undefined;
	}
	if (process.platform === "darwin") {
		const output = capture("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { allowFailure: true });
		const pathLine = output.split("\n").find((line) => line.startsWith("n"));
		return pathLine?.slice(1);
	}
	return undefined;
}

function isProcessRunning(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error instanceof Error && "code" in error && error.code === "EPERM";
	}
}

function findCompatiblePython(options = {}) {
	const allowInstall = options.allowInstall ?? true;
	const search = () => {
		const names = process.platform === "darwin" && process.arch === "x64"
			? ["python3.12", "python3.11", "python3.10", "python3"]
			: ["python3", "python3.14", "python3.13", "python3.12", "python3.11", "python3.10"];
		const candidates = [...new Set(names.map(findOnPath).filter(Boolean))];
		for (const candidate of candidates) {
			const version = capture(candidate, ["-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"], {
				allowFailure: true,
			}).trim();
			const [major, minor] = version.split(".").map(Number);
			if (major !== 3 || minor < 10) continue;
			if (process.platform === "darwin" && process.arch === "x64" && minor > 12) continue;
			return candidate;
		}
		return undefined;
	};

	let found = search();
	if (!found && allowInstall) {
		tryAutoInstallPython();
		found = search();
	}
	if (found) return found;

	throw new Error(
		process.platform === "darwin" && process.arch === "x64"
			? "Code indexing requires Python 3.10-3.12 on Intel macOS. Please install Python 3."
			: "Code indexing requires Python 3.10 or newer. Please install Python 3.",
	);
}

function tryAutoInstallPython() {
	console.log("No compatible Python 3 (>= 3.10) found on PATH. Attempting automatic installation...");
	if (process.platform === "darwin") {
		const brew = findOnPath("brew") || (fs.existsSync("/opt/homebrew/bin/brew") ? "/opt/homebrew/bin/brew" : undefined);
		if (brew) {
			const pkg = process.arch === "x64" ? "python@3.12" : "python3";
			run(brew, ["install", pkg], { allowFailure: true });
		}
	} else if (process.platform === "linux") {
		const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
		if (findOnPath("apt-get")) {
			const cmd = isRoot ? "apt-get" : "sudo";
			const argsUpdate = isRoot ? ["update", "-qq"] : ["apt-get", "update", "-qq"];
			const argsInstall = isRoot
				? ["install", "-y", "-qq", "python3", "python3-venv", "python3-dev"]
				: ["apt-get", "install", "-y", "-qq", "python3", "python3-venv", "python3-dev"];
			run(cmd, argsUpdate, { allowFailure: true });
			run(cmd, argsInstall, { allowFailure: true });
		} else if (findOnPath("dnf")) {
			const cmd = isRoot ? "dnf" : "sudo";
			const args = isRoot ? ["install", "-y", "python3", "python3-devel"] : ["dnf", "install", "-y", "python3", "python3-devel"];
			run(cmd, args, { allowFailure: true });
		} else if (findOnPath("pacman")) {
			const cmd = isRoot ? "pacman" : "sudo";
			const args = isRoot ? ["-Sy", "--noconfirm", "python"] : ["pacman", "-Sy", "--noconfirm", "python"];
			run(cmd, args, { allowFailure: true });
		}
	}
}

function linuxAmdNpuHardwarePresent() {
	return process.platform === "linux" && (
		fs.existsSync("/dev/accel/accel0") ||
		fs.existsSync("/dev/amdxdna") ||
		fs.existsSync("/sys/class/accel")
	);
}

function linuxNpuUnsupportedMessage(hasNpuDevice) {
	const prefix = hasNpuDevice
		? "AMD XDNA NPU hardware was detected, but"
		: "Linux NPU indexing was requested, but";
	return `${prefix} p does not install or validate the AMD Ryzen AI/XRT/XDNA runtime automatically. `
		+ "Use CPU indexing, or install AMD's matched Ryzen AI runtime and configure an explicit Vitis AI backend.";
}

function findOnPath(name) {
	for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
		if (!directory) continue;
		const candidate = path.join(directory, name);
		try {
			fs.accessSync(candidate, fs.constants.X_OK);
			return candidate;
		} catch {
			// Continue searching PATH.
		}
	}
	return undefined;
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, { stdio: options.allowFailure ? "ignore" : "inherit" });
	if (result.error && !options.allowFailure) throw result.error;
	if (result.status !== 0 && !options.allowFailure) {
		throw new Error(`${command} exited with status ${result.status ?? "unknown"}`);
	}
	return result.status === 0;
}

function capture(command, args, options = {}) {
	const result = spawnSync(command, args, { encoding: "utf-8" });
	if (result.error && !options.allowFailure) throw result.error;
	if (result.status !== 0 && !options.allowFailure) {
		throw new Error(`${command} exited with status ${result.status ?? "unknown"}: ${result.stderr?.trim() ?? ""}`);
	}
	return result.status === 0 ? `${result.stdout ?? ""}${result.stderr ?? ""}` : "";
}

function writeFileAtomic(filePath, content) {
	const temporaryPath = `${filePath}.${process.pid}.tmp`;
	fs.writeFileSync(temporaryPath, content, { mode: 0o600 });
	fs.renameSync(temporaryPath, filePath);
}

function readFileIfPresent(filePath) {
	try {
		return fs.readFileSync(filePath, "utf-8");
	} catch {
		return undefined;
	}
}

function hasArgumentSequence(command, args) {
	const pattern = args.map((argument) => escapeRegExp(argument)).join("\\s+");
	return new RegExp(`(?:^|\\s)${pattern}(?=\\s|$)`).test(command);
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeXml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

function escapeSystemd(value) {
	return String(value).replaceAll("%", "%%").replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function escapeSystemdPath(value) {
	return escapeSystemd(value).replaceAll(" ", "\\x20").replaceAll("\t", "\\x09");
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
	void main().catch((error) => {
		console.error(`Failed to install code indexing service: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	});
}
