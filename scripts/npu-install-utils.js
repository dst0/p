import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function parseOsRelease(content) {
	const values = {};
	for (const line of content.split("\n")) {
		const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
		if (!match) continue;
		let value = match[2];
		if (
			(value.startsWith('"') && value.endsWith('"'))
			|| (value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		values[match[1]] = value;
	}
	return values;
}

export function parseKernelVersion(release) {
	const match = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(release.trim());
	if (!match) throw new Error(`Unable to parse Linux kernel version: ${release}`);
	return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

export function runElevated(command, args, options = {}) {
	if (typeof process.getuid === "function" && process.getuid() === 0) {
		return runCommand(command, args, options);
	}
	return runCommand("sudo", [command, ...args], options);
}

export function runCommand(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: options.cwd,
		env: options.env ?? process.env,
		stdio: options.allowFailure ? "ignore" : "inherit",
	});
	if (result.error && !options.allowFailure) throw result.error;
	if (result.status !== 0 && !options.allowFailure) {
		throw new Error(`${command} exited with status ${result.status ?? "unknown"}`);
	}
	return result.status === 0;
}

export function captureCommand(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: options.cwd,
		encoding: "utf-8",
		env: options.env ?? process.env,
	});
	if (result.error && !options.allowFailure) throw result.error;
	if (result.status !== 0 && !options.allowFailure) {
		throw new Error(`${command} exited with status ${result.status ?? "unknown"}: ${result.stderr?.trim() ?? ""}`);
	}
	return result.status === 0 ? `${result.stdout ?? ""}${result.stderr ?? ""}` : "";
}

export function findOnPath(name) {
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

export function readTrimmedFile(filePath) {
	try {
		return fs.readFileSync(filePath, "utf-8").trim();
	} catch {
		return "";
	}
}

export function normalizeHex(value, width) {
	if (typeof value !== "string" || value.length === 0) return "";
	const normalized = value.toLowerCase().replace(/^0x/, "");
	return `0x${normalized.padStart(width, "0")}`;
}

export function compareVersions(left, right) {
	for (let index = 0; index < Math.max(left.length, right.length); index++) {
		const difference = (left[index] ?? 0) - (right[index] ?? 0);
		if (difference !== 0) return difference;
	}
	return 0;
}

export function writeJsonAtomic(filePath, value) {
	const temporaryPath = `${filePath}.${process.pid}.tmp`;
	fs.writeFileSync(temporaryPath, `${JSON.stringify(value, undefined, 2)}\n`, { mode: 0o600 });
	fs.renameSync(temporaryPath, filePath);
}

export function readJsonFile(filePath) {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf-8"));
	} catch {
		return undefined;
	}
}
