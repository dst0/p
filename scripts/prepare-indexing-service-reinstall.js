#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
	getIndexingReinstallControlPath,
	getIndexingReinstallReadyPath,
} from "../packages/coding-agent/dist/indexing-service-daemon.js";
import { INDEXING_SERVICE_REINSTALL_FILE } from "../packages/coding-agent/dist/core/indexing-service.js";

const AGENT_DIR = process.env.P_CODING_AGENT_DIR ?? path.join(os.homedir(), ".p", "agent");
const STATUS_PATH = path.join(AGENT_DIR, "indexing-service-status.json");
const CONTROL_PATH = getIndexingReinstallControlPath(AGENT_DIR);
const READY_PATH = getIndexingReinstallReadyPath(AGENT_DIR);
const REINSTALL_PATH = path.join(AGENT_DIR, INDEXING_SERVICE_REINSTALL_FILE);
const DEFAULT_WAIT_MS = 10_000;
const DEFAULT_STOP_WAIT_MS = 5_000;
const KILL_WAIT_MS = 5_000;
const LEGACY_IDLE_STABILITY_MS = 1_000;
const POLL_MS = 100;
const ACTIVE_STATES = new Set(["queued", "initializing", "updating"]);

if (process.argv.includes("--clear")) {
	fs.rmSync(REINSTALL_PATH, { force: true });
} else if (process.argv.includes("--skip-quiesce")) {
	// Version unchanged; skip the quiesce handshake but still write the reinstall marker
	// so the daemon knows an install is happening.
	const status = readJson(STATUS_PATH);
	const pid = status && Number.isSafeInteger(status.pid) && status.pid > 0 ? status.pid : undefined;
	if (pid && isProcessRunning(pid) && isIndexingDaemonProcess(pid)) {
		writeReinstallMarker(pid);
	}
	console.log("Indexing version unchanged; skipping quiesce. Reinstall can continue.");
} else {
	await prepareForReinstall();
}

async function prepareForReinstall() {
	const status = readJson(STATUS_PATH);
	const pid = status && Number.isSafeInteger(status.pid) && status.pid > 0 ? status.pid : undefined;
	if (!pid || !isProcessRunning(pid)) {
		console.log("Code indexing service is not running; reinstall can continue.");
		return;
	}
	if (!isIndexingDaemonProcess(pid)) {
		throw new Error(
			`Refusing to signal pid ${pid}: it is not the code indexing daemon (${readProcessCommand(pid) || "command unavailable"})`,
		);
	}

	const timeoutMs =
		readPositiveInteger(process.env.P_INDEXING_REINSTALL_WAIT_MS, "P_INDEXING_REINSTALL_WAIT_MS") ??
		DEFAULT_WAIT_MS;
	const stopWaitMs =
		readPositiveInteger(process.env.P_INDEXING_REINSTALL_STOP_WAIT_MS, "P_INDEXING_REINSTALL_STOP_WAIT_MS") ??
		DEFAULT_STOP_WAIT_MS;
	const control = readJson(CONTROL_PATH);
	const supportsQuiesce = control?.pid === pid && control?.protocolVersion === 1;
	fs.rmSync(READY_PATH, { force: true });
	writeReinstallMarker(pid);

	if (supportsQuiesce) {
		console.log(
			`Preparing code indexing service ${pid} for a safe reinstall (waiting up to ${formatDuration(timeoutMs)})...`,
		);
		process.kill(pid, "SIGUSR1");
		const result = await waitForQuiesceMarker(pid, timeoutMs);
		if (result === "ready") {
			writeReinstallMarker(pid);
			console.log("Active indexing completed and the daemon is quiescent.");
			return;
		}
		if (result === "exited") {
			writeReinstallMarker(pid);
			console.log("Code indexing service stopped before the quiesce handshake completed; reinstall can continue.");
			return;
		}
		console.warn(
			`Code indexing service ${pid} did not become quiescent within ${formatDuration(timeoutMs)}; stopping it so reinstall can continue.`,
		);
		await stopDaemonForReinstall(pid, stopWaitMs);
		writeReinstallMarker(pid);
		console.log("Code indexing service stopped; reinstall can continue.");
		return;
	}

	// Check if version file exists (set by reinstall.sh after build when version is unchanged)
	// This is a fallback for when the --skip-quiesce flag wasn't used but the version file is present.
	const versionFilePath = path.join(AGENT_DIR, "indexing-version-unchanged");
	if (fs.existsSync(versionFilePath)) {
		writeReinstallMarker(pid);
		fs.rmSync(versionFilePath, { force: true });
		console.log("Indexing version unchanged (version file detected); skipping quiesce. Reinstall can continue.");
		return;
	}

	// The currently running daemon predates the quiesce protocol. Give it a short
	// opportunity to become idle, then stop it rather than blocking reinstall for
	// the duration of a long indexing pass.
	console.log(
		`Waiting up to ${formatDuration(timeoutMs)} for legacy code indexing service ${pid} to become idle...`,
	);
	const result = await waitForLegacyIdle(pid, timeoutMs);
	if (result === "idle") {
		writeReinstallMarker(pid);
		console.log("Legacy code indexing service is idle; reinstall can continue.");
		return;
	}
	if (result === "exited") {
		writeReinstallMarker(pid);
		console.log("Legacy code indexing service stopped; reinstall can continue.");
		return;
	}
	console.warn(
		`Legacy code indexing service ${pid} did not become idle within ${formatDuration(timeoutMs)}; stopping it so reinstall can continue.`,
	);
	await stopDaemonForReinstall(pid, stopWaitMs);
	writeReinstallMarker(pid);
	console.log("Legacy code indexing service stopped; reinstall can continue.");
}

async function waitForQuiesceMarker(pid, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!isProcessRunning(pid)) return "exited";
		const marker = readJson(READY_PATH);
		if (marker?.pid === pid) return "ready";
		await sleep(POLL_MS);
	}
	return "timeout";
}

async function waitForLegacyIdle(pid, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	let idleSince;
	while (Date.now() < deadline) {
		if (!isProcessRunning(pid)) return "exited";
		const status = readJson(STATUS_PATH);
		const belongsToProcess = status?.pid === pid && status?.running !== false;
		const hasActiveWork =
			!belongsToProcess ||
			!Array.isArray(status.repos) ||
			status.repos.some((repository) => ACTIVE_STATES.has(repository?.state));
		if (hasActiveWork) {
			idleSince = undefined;
		} else {
			idleSince ??= Date.now();
			if (Date.now() - idleSince >= LEGACY_IDLE_STABILITY_MS) return "idle";
		}
		await sleep(POLL_MS);
	}
	return "timeout";
}

async function stopDaemonForReinstall(pid, stopWaitMs) {
	if (!isProcessRunning(pid)) return;
	if (!isIndexingDaemonProcess(pid)) {
		throw new Error(`Refusing to stop pid ${pid}: it is no longer the code indexing daemon`);
	}
	try {
		process.kill(pid, "SIGTERM");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ESRCH") return;
		throw error;
	}
	if (await waitForProcessExit(pid, stopWaitMs)) return;
	if (!isIndexingDaemonProcess(pid)) {
		throw new Error(`Refusing to force-stop pid ${pid}: it is no longer the code indexing daemon`);
	}
	console.warn(`Code indexing service ${pid} did not stop after SIGTERM; sending SIGKILL.`);
	process.kill(pid, "SIGKILL");
	if (!(await waitForProcessExit(pid, KILL_WAIT_MS))) {
		throw new Error(`Timed out stopping code indexing service ${pid}`);
	}
}

async function waitForProcessExit(pid, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!isProcessRunning(pid)) return true;
		await sleep(POLL_MS);
	}
	return !isProcessRunning(pid);
}

function writeReinstallMarker(pid) {
	fs.mkdirSync(path.dirname(REINSTALL_PATH), { recursive: true, mode: 0o700 });
	const temporaryPath = `${REINSTALL_PATH}.${process.pid}.tmp`;
	fs.writeFileSync(
		temporaryPath,
		`${JSON.stringify({ pid, startedAt: new Date().toISOString() })}\n`,
		{ mode: 0o600 },
	);
	fs.renameSync(temporaryPath, REINSTALL_PATH);
}

function isIndexingDaemonProcess(pid) {
	return isIndexingDaemonCommand(readProcessCommand(pid));
}

function readProcessCommand(pid) {
	const procCommand = readLinuxProcessCommand(pid);
	if (procCommand !== undefined) return procCommand;
	const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
	return result.status === 0 ? result.stdout.trim() : "";
}

function isProcessRunning(pid) {
	try {
		process.kill(pid, 0);
		const procState = readLinuxProcessState(pid);
		if (procState !== undefined) return procState !== "Z";
		const state = spawnSync("ps", ["-p", String(pid), "-o", "stat="], { encoding: "utf8" });
		return state.status !== 0 || !state.stdout.trimStart().startsWith("Z");
	} catch (error) {
		return error instanceof Error && "code" in error && error.code === "EPERM";
	}
}

function isIndexingDaemonCommand(command) {
	return /(?:^|\s)\S*node(?:js)?(?:\.exe)?\s+.*indexing-service-daemon\.js(?:\s|$)/.test(command);
}

function readLinuxProcessCommand(pid) {
	if (process.platform !== "linux") return undefined;
	try {
		return fs.readFileSync(`/proc/${pid}/cmdline`).toString("utf8").split("\0").filter(Boolean).join(" ");
	} catch {
		return undefined;
	}
}

function readLinuxProcessState(pid) {
	if (process.platform !== "linux") return undefined;
	try {
		const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
		const commandEnd = stat.lastIndexOf(") ");
		return commandEnd >= 0 ? stat[commandEnd + 2] : undefined;
	} catch {
		return undefined;
	}
}

function readJson(filePath) {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch {
		return undefined;
	}
}

function readPositiveInteger(value, name) {
	if (value === undefined) return undefined;
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) {
		throw new Error(`${name} must be a positive integer`);
	}
	return parsed;
}

function formatDuration(milliseconds) {
	if (milliseconds < 1_000) return `${milliseconds}ms`;
	return `${Math.ceil(milliseconds / 1_000)}s`;
}

function sleep(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
