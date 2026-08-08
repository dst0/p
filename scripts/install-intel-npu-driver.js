import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCommand, runElevated } from "./npu-install-utils.js";

export function installUbuntuHweKernel() {
	runElevated("apt-get", ["update", "-qq"]);
	runElevated("apt-get", ["install", "-y", "--install-recommends", "linux-generic-hwe-24.04"]);
}

export function installSystemPrerequisites() {
	runElevated("apt-get", ["update", "-qq"]);
	runElevated("apt-get", ["install", "-y", "acl", "ca-certificates", "curl", "libtbb12", "pciutils"]);
}

export function installLevelZeroPackage(packagePath) {
	if (runElevated("apt-get", ["install", "-y", "--allow-downgrades", packagePath], { allowFailure: true })) return;
	for (const conflictingPackage of ["level-zero", "level-zero-devel"]) {
		if (isDebianPackageInstalled(conflictingPackage)) {
			runElevated("dpkg", ["--purge", "--force-remove-reinstreq", conflictingPackage]);
		}
	}
	runElevated("apt-get", ["install", "-y", "--allow-downgrades", packagePath]);
}

export function installIntelNpuAccessRule() {
	const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "p-intel-npu-udev-"));
	const temporaryFile = path.join(temporaryDirectory, "99-intel-npu.rules");
	try {
		fs.writeFileSync(
			temporaryFile,
			'SUBSYSTEM=="accel", KERNEL=="accel*", GROUP="render", MODE="0660", TAG+="uaccess"\n',
			{ mode: 0o600 },
		);
		runElevated("install", ["-D", "-m", "0644", temporaryFile, "/etc/udev/rules.d/99-intel-npu.rules"]);
	} finally {
		fs.rmSync(temporaryDirectory, { recursive: true, force: true });
	}
}

export function ensureIntelNpuUserAccess() {
	const user = process.env.SUDO_USER || os.userInfo().username;
	if (!user || user === "root") return;
	runElevated("gpasswd", ["-a", user, "render"]);
	for (const deviceNode of findAccelDeviceNodes()) {
		runElevated("setfacl", ["-m", `u:${user}:rw`, deviceNode]);
	}
}

export function downloadVerifiedFile(url, destination, expectedSha256) {
	runCommand("curl", ["--fail", "--location", "--retry", "3", "--output", destination, url]);
	const digest = createHash("sha256").update(fs.readFileSync(destination)).digest("hex");
	if (digest !== expectedSha256) {
		throw new Error(`Checksum mismatch for ${path.basename(destination)}: expected ${expectedSha256}, got ${digest}`);
	}
}

export function findFiles(directory, predicate) {
	const matches = [];
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) matches.push(...findFiles(entryPath, predicate));
		else if (entry.isFile() && predicate(entry.name)) matches.push(entryPath);
	}
	return matches.sort();
}

function findAccelDeviceNodes() {
	try {
		return fs.readdirSync("/dev/accel")
			.filter((name) => /^accel\d+$/.test(name))
			.map((name) => path.join("/dev/accel", name));
	} catch {
		return [];
	}
}

function isDebianPackageInstalled(packageName) {
	return runCommand("dpkg-query", ["-W", "-f=${db:Status-Status}", packageName], { allowFailure: true });
}
