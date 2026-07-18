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
const REQUIREMENTS = path.join(CODE_INDEX_DIR, "requirements.txt");
const AGENT_DIR = process.env.P_CODING_AGENT_DIR ?? path.join(os.homedir(), ".p", "agent");
const SERVICE_ROOT = path.join(AGENT_DIR, "indexing-service");
const BIN_DIR = path.join(SERVICE_ROOT, "bin");
const VENV_DIR = path.join(SERVICE_ROOT, "venv");
const QDRANT_DATA_DIR = path.join(AGENT_DIR, "code-rag", "qdrant");
const LOG_DIR = path.join(SERVICE_ROOT, "logs");
const SERVICE_LABEL = "com.dst.p.code-index";
const LEGACY_SERVICE_LABEL = "com.dst.p.code-index-embedding";
const QDRANT_VERSION = "1.18.3";
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

async function main() {
	if (!getQdrantAsset()) {
		throw new Error(`Code indexing service is not supported on ${process.platform}/${process.arch}`);
	}
	const python = findCompatiblePython();
	const venvPython = path.join(VENV_DIR, "bin", "python");
	const qdrantBinary = path.join(BIN_DIR, "qdrant");
	const environment = {
		P_CODING_AGENT_DIR: AGENT_DIR,
		P_CODE_RAG_PYTHON: venvPython,
		P_CODE_RAG_QDRANT_BINARY: qdrantBinary,
		P_CODE_RAG_QDRANT_DATA_DIR: QDRANT_DATA_DIR,
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
		console.log(`Indexing service installation validated for ${process.platform}/${process.arch} with ${python}`);
		return;
	}

	if (!fs.existsSync(DAEMON)) throw new Error(`Built indexing daemon not found: ${DAEMON}`);
	fs.mkdirSync(BIN_DIR, { recursive: true, mode: 0o700 });
	fs.mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
	fs.mkdirSync(QDRANT_DATA_DIR, { recursive: true, mode: 0o700 });
	await installQdrant(qdrantBinary);
	installPythonEnvironment(python, venvPython);
	mergeCodeRagConfig({
		qdrantBinary,
		qdrantDataDirectory: QDRANT_DATA_DIR,
		pythonExecutable: venvPython,
	});

	if (process.platform === "darwin") await installDarwin(renderLaunchdPlist(values));
	else installLinux(renderSystemdUnit(values));
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
		run("tar", ["-xzf", archive, "-C", BIN_DIR]);
		fs.chmodSync(qdrantBinary, 0o755);
		const version = capture(qdrantBinary, ["--version"]);
		if (!version.includes(QDRANT_VERSION)) throw new Error(`Unexpected Qdrant version: ${version.trim()}`);
	} finally {
		fs.rmSync(temporaryDirectory, { recursive: true, force: true });
	}
}

function installPythonEnvironment(python, venvPython) {
	const requirements = fs.readFileSync(REQUIREMENTS, "utf-8");
	const markerPath = path.join(VENV_DIR, ".p-requirements");
	const marker = createHash("sha256")
		.update(`${python}\0${capture(python, ["--version"])}\0${requirements}`)
		.digest("hex");
	if (fs.existsSync(venvPython) && readFileIfPresent(markerPath) === marker) return;
	console.log("Installing pinned code-index Python dependencies");
	run(python, ["-m", "venv", VENV_DIR]);
	run(venvPython, [
		"-m",
		"pip",
		"install",
		"--disable-pip-version-check",
		"--only-binary=:all:",
		"--requirement",
		REQUIREMENTS,
	]);
	fs.writeFileSync(markerPath, marker, { mode: 0o600 });
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
	const launchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
	const plistPath = path.join(launchAgentsDir, `${SERVICE_LABEL}.plist`);
	const legacyPlistPath = path.join(launchAgentsDir, `${LEGACY_SERVICE_LABEL}.plist`);
	fs.mkdirSync(launchAgentsDir, { recursive: true });
	run("launchctl", ["bootout", `gui/${uid}/${LEGACY_SERVICE_LABEL}`], { allowFailure: true });
	await waitForLaunchdRemoval(uid, LEGACY_SERVICE_LABEL);
	if (fs.existsSync(legacyPlistPath)) fs.rmSync(legacyPlistPath);
	run("launchctl", ["bootout", `gui/${uid}/${SERVICE_LABEL}`], { allowFailure: true });
	await waitForLaunchdRemoval(uid, SERVICE_LABEL);
	writeFileAtomic(plistPath, plist);
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

function installLinux(unit) {
	const unitDirectory = path.join(os.homedir(), ".config", "systemd", "user");
	const unitPath = path.join(unitDirectory, `${SERVICE_LABEL}.service`);
	const legacyUnitPath = path.join(unitDirectory, `${LEGACY_SERVICE_LABEL}.service`);
	fs.mkdirSync(unitDirectory, { recursive: true });
	run("systemctl", ["--user", "disable", "--now", `${LEGACY_SERVICE_LABEL}.service`], { allowFailure: true });
	if (fs.existsSync(legacyUnitPath)) fs.rmSync(legacyUnitPath);
	writeFileAtomic(unitPath, unit);
	run("systemctl", ["--user", "daemon-reload"]);
	run("systemctl", ["--user", "enable", "--now", `${SERVICE_LABEL}.service`]);
	run("systemctl", ["--user", "is-active", "--quiet", `${SERVICE_LABEL}.service`]);
}

function findCompatiblePython() {
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
	throw new Error(
		process.platform === "darwin" && process.arch === "x64"
			? "Code indexing requires Python 3.10-3.12 on Intel macOS"
			: "Code indexing requires Python 3.10 or newer",
	);
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
