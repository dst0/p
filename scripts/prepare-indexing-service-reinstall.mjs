#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
	getIndexingReinstallControlPath,
	getIndexingReinstallReadyPath,
} from "../packages/coding-agent/dist/indexing-service-daemon.js";

const AGENT_DIR = process.env.P_CODING_AGENT_DIR ?? path.join(os.homedir(), ".p", "agent");
const STATUS_PATH = path.join(AGENT_DIR, "indexing-service-status.json");
const CONTROL_PATH = getIndexingReinstallControlPath(AGENT_DIR);
const READY_PATH = getIndexingReinstallReadyPath(AGENT_DIR);
const DEFAULT_WAIT_MS = 35 * 60_000;
const LEGACY_IDLE_STABILITY_MS = 1_000;
const POLL_MS = 200;
const ACTIVE_STATES = new Set(["queued", "initializing", "updating"]);

await prepareForReinstall();

async function prepareForReinstall() {
	const status = readJson(STATUS_PATH);
	const pid = status && Number.isSafeInteger(status.pid) && status.pid > 0 ? status.pid : undefined;
	if (!pid || !isProcessRunning(pid)) {
		console.log("Code indexing service is not running; reinstall can continue.");
		return;
	}
	if (!isIndexingDaemonProcess(pid)) {
		throw new Error(`Refusing to signal pid ${pid}: it is not the code indexing daemon`);
	}

	const timeoutMs = readPositiveInteger(process.env.P_INDEXING_REINSTALL_WAIT_MS) ?? DEFAULT_WAIT_MS;
	const control = readJson(CONTROL_PATH);
	const supportsQuiesce = control?.pid === pid && control?.protocolVersion === 1;
	fs.rmSync(READY_PATH, { force: true });

	if (supportsQuiesce) {
		console.log(`Preparing code indexing service ${pid} for a safe reinstall...`);
		process.kill(pid, "SIGUSR1");
		await waitForQuiesceMarker(pid, timeoutMs);
		console.log("Active indexing completed and the daemon is quiescent.");
		return;
	}

	// The currently running daemon predates the quiesce protocol. Do not kill it:
	// wait for its public status to remain idle before allowing the installer to
	// replace it. This path is only needed for the first upgrade to this version.
	console.log(`Waiting for legacy code indexing service ${pid} to become idle...`);
	await waitForLegacyIdle(pid, timeoutMs);
	console.log("Legacy code indexing service is idle; reinstall can continue.");
}

async function waitForQuiesceMarker(pid, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!isProcessRunning(pid)) return;
		const marker = readJson(READY_PATH);
		if (marker?.pid === pid) return;
		await sleep(POLL_MS);
	}
	throw new Error(
		`Timed out waiting for code indexing service ${pid} to finish active work; reinstall was not allowed to interrupt it`,
	);
}

async function waitForLegacyIdle(pid, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	let idleSince;
	while (Date.now() < deadline) {
		if (!isProcessRunning(pid)) return;
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
			if (Date.now() - idleSince >= LEGACY_IDLE_STABILITY_MS) return;
		}
		await sleep(POLL_MS);
	}
	throw new Error(
		`Timed out waiting for legacy code indexing service ${pid} to become idle; reinstall was not allowed to interrupt it`,
	);
}

function isIndexingDaemonProcess(pid) {
	const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
	if (result.status !== 0) return false;
	return /(?:^|\s)\S*node(?:js)?(?:\.exe)?\s+.*indexing-service-daemon\.js(?:\s|$)/.test(result.stdout.trim());
}

function isProcessRunning(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error instanceof Error && "code" in error && error.code === "EPERM";
	}
}

function readJson(filePath) {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch {
		return undefined;
	}
}

function readPositiveInteger(value) {
	if (value === undefined) return undefined;
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) {
		throw new Error("P_INDEXING_REINSTALL_WAIT_MS must be a positive integer");
	}
	return parsed;
}

function sleep(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
