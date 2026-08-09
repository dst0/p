import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { captureCommand, runCommand, runElevated } from "./npu-install-utils.js";

export function installUbuntuHweKernel() {
  runElevated("apt-get", ["update", "-qq"]);
  runElevated("apt-get", ["install", "-y", "--install-recommends", "linux-generic-hwe-24.04"]);
}

export function installAmdXdnaPpaRuntime(packageVersions = {}) {
  runElevated("apt-get", ["update", "-qq"]);
  runElevated("apt-get", ["install", "-y", "software-properties-common"]);
  runElevated("add-apt-repository", ["-y", "ppa:amd-team/xrt"]);
  runElevated("apt-get", ["update", "-qq"]);
	runElevated("apt-get", [
		"install",
		"-y",
		...[
			"git",
			"libxrt2",
			"libxrt-npu2",
			"libxrt-dev",
			"libxrt-utils",
			"libxrt-utils-npu",
			"amdxdna-dkms",
		].map((packageName) =>
			packageVersions[packageName] ? `${packageName}=${packageVersions[packageName]}` : packageName),
	]);
}

export function ensureAmdNpuAccess(userName = process.env.SUDO_USER ?? process.env.USER) {
  if (!userName) throw new Error("Unable to determine the user that needs AMD NPU access");
  const groups = captureCommand("id", ["-nG", userName], { allowFailure: true }).trim().split(/\s+/);
  if (groups.includes("render")) return false;
  runElevated("usermod", ["-aG", "render", userName]);
  return true;
}

export function installAmdXdnaDriver(runtimeRoot, manifest) {
	fs.mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 });
	installDriverBuildPrerequisites();
	const sourceRoot = prepareXdnaDriverSource(runtimeRoot, manifest);
	buildAndInstallXrt(sourceRoot);
	buildAndInstallXdnaPlugin(sourceRoot);
	installMemlockConfiguration();
	runElevated("modprobe", ["amdxdna"]);
}

function installDriverBuildPrerequisites() {
	runElevated("apt-get", ["update", "-qq"]);
	runElevated("apt-get", [
		"install",
		"-y",
		"build-essential",
		"ca-certificates",
		"cmake",
		"debhelper",
		"devscripts",
		"dkms",
		"git",
		"libboost-dev",
		"libboost-filesystem1.74.0",
		"ninja-build",
		"pciutils",
		"pkg-config",
		"protobuf-compiler",
		"python3.12",
		"python3.12-dev",
		"python3.12-venv",
	]);
}

function prepareXdnaDriverSource(runtimeRoot, manifest) {
	const sourceRoot = path.join(runtimeRoot, `xdna-driver-${manifest.xdnaDriver.tag}`);
	if (fs.existsSync(sourceRoot)) {
		const revision = captureCommand("git", ["-C", sourceRoot, "rev-parse", "HEAD"], { allowFailure: true }).trim();
		if (revision === manifest.xdnaDriver.commit) return sourceRoot;
		fs.rmSync(sourceRoot, { recursive: true, force: true });
	}
	runCommand("git", [
		"clone",
		"--branch",
		manifest.xdnaDriver.tag,
		"--depth",
		"1",
		"--recurse-submodules",
		manifest.xdnaDriver.repository,
		sourceRoot,
	]);
	const revision = captureCommand("git", ["-C", sourceRoot, "rev-parse", "HEAD"]).trim();
	if (revision !== manifest.xdnaDriver.commit) {
		throw new Error(`AMD XDNA source revision mismatch: expected ${manifest.xdnaDriver.commit}, got ${revision}`);
	}
	return sourceRoot;
}

function buildAndInstallXrt(sourceRoot) {
	runElevated("bash", [path.join(sourceRoot, "tools", "amdxdna_deps.sh")], { cwd: sourceRoot });
	const buildDirectory = path.join(sourceRoot, "xrt", "build");
	runCommand(path.join(buildDirectory, "build.sh"), ["-npu", "-opt", "-j", String(buildWorkerCount())], {
		cwd: buildDirectory,
	});
	const releaseDirectory = path.join(buildDirectory, "Release");
	const packages = [
		findSinglePackage(releaseDirectory, /-base\.deb$/),
		findSinglePackage(releaseDirectory, /-base-dev\.deb$/),
		findSinglePackage(releaseDirectory, /-npu\.deb$/),
	];
	runElevated("apt-get", ["install", "-y", "--fix-broken", ...packages]);
}

function buildAndInstallXdnaPlugin(sourceRoot) {
	const buildDirectory = path.join(sourceRoot, "build");
	runCommand(path.join(buildDirectory, "build.sh"), ["-release", "-j", String(buildWorkerCount())], {
		cwd: buildDirectory,
	});
	const pluginPackage = findSinglePackage(
		path.join(buildDirectory, "Release"),
		/^xrt_plugin\..*amdxdna\.deb$/,
	);
	runElevated("apt-get", ["install", "-y", "--fix-broken", pluginPackage]);
}

function installMemlockConfiguration() {
	const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "p-amdxdna-limits-"));
	const temporaryFile = path.join(temporaryDirectory, "99-amdxdna.conf");
	try {
		fs.writeFileSync(temporaryFile, "* soft memlock unlimited\n* hard memlock unlimited\n", { mode: 0o600 });
		runElevated("install", ["-D", "-m", "0644", temporaryFile, "/etc/security/limits.d/99-amdxdna.conf"]);
	} finally {
		fs.rmSync(temporaryDirectory, { recursive: true, force: true });
	}
}

function findSinglePackage(directory, pattern) {
	const matches = fs.readdirSync(directory)
		.filter((name) => pattern.test(name))
		.map((name) => path.join(directory, name));
	if (matches.length !== 1) {
		throw new Error(`Expected one package matching ${pattern} in ${directory}, found ${matches.length}`);
	}
	return matches[0];
}

function buildWorkerCount() {
	return Math.max(1, Math.min(8, os.availableParallelism?.() ?? os.cpus().length));
}
