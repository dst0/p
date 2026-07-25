import assert from "node:assert/strict";
import test from "node:test";
import {
	collectResourceEnvironment,
	getQdrantAsset,
	isIndexingDaemonCommand,
	isManagedBackendCommand,
	renderLaunchdPlist,
	renderSystemdUnit,
	selectTorchInstallPlan,
	selectIndexingDaemonPids,
	selectManagedBackendPids,
} from "./install-indexing-service.js";

const values = {
	node: "/opt/p/node",
	daemon: "/opt/p/indexing-service-daemon.js",
	root: "/opt/p checkout",
	environment: { P_CODING_AGENT_DIR: "/tmp/p-agent" },
	stdout: "/tmp/p-service.log",
	stderr: "/tmp/p-service-error.log",
};

test("renders launchd and systemd services for the persistent daemon", () => {
	assert.match(renderLaunchdPlist(values), /com\.dst\.p\.code-index/);
	assert.match(renderLaunchdPlist(values), /indexing-service-daemon\.js/);
	assert.match(renderSystemdUnit(values), /Restart=always/);
	assert.match(renderSystemdUnit(values), /indexing-service-daemon\.js/);
});

test("persists embedding and file-preparation resource overrides", () => {
	assert.deepEqual(
		collectResourceEnvironment({
			P_CODE_RAG_MAX_CPU_THREADS: "12",
			P_CODE_RAG_PREPARATION_MAX_WORKERS: "8",
			P_CODE_RAG_PREPARATION_WORKER_MEMORY_MB: "96",
			P_CODE_RAG_PREPARATION_MEMORY_RESERVE_MB: "768",
			UNRELATED_VALUE: "ignored",
		}),
		{
			P_CODE_RAG_MAX_CPU_THREADS: "12",
			P_CODE_RAG_PREPARATION_MAX_WORKERS: "8",
			P_CODE_RAG_PREPARATION_WORKER_MEMORY_MB: "96",
			P_CODE_RAG_PREPARATION_MEMORY_RESERVE_MB: "768",
		},
	);
});

test("recognizes only the installed indexing daemon command", () => {
	assert.equal(isIndexingDaemonCommand("/usr/bin/node /opt/p/indexing-service-daemon.js"), true);
	assert.equal(isIndexingDaemonCommand("/usr/bin/node /opt/p/indexing-service-daemon.js --verbose"), true);
	assert.equal(isIndexingDaemonCommand("/usr/bin/node /tmp/indexing-service-daemon.js.bak"), false);
	assert.equal(isIndexingDaemonCommand("grep indexing-service-daemon.js"), false);
});

test("selects status-owned and checkout-owned stale daemons", () => {
	const processTable = [
		"101 /usr/bin/node /opt/p/packages/coding-agent/dist/indexing-service-daemon.js",
		"102 node packages/coding-agent/dist/indexing-service-daemon.js",
		"103 node /other/indexing-service-daemon.js",
		"104 grep indexing-service-daemon.js",
	].join("\n");
	const workingDirectories = new Map([
		[102, "/opt/p"],
		[103, "/other"],
	]);
	assert.deepEqual(
		selectIndexingDaemonPids(processTable, {
			daemonPath: "/opt/p/packages/coding-agent/dist/indexing-service-daemon.js",
			rootPath: "/opt/p",
			statusPid: 103,
			cwdForPid: (pid) => workingDirectories.get(pid),
		}),
		[101, 102, 103],
	);
});

test("selects only backends managed by this checkout and agent directory", () => {
	const options = {
		qdrantBinary: "/opt/p service/qdrant",
		qdrantConfigPath: "/agent/code-rag/qdrant/config.yaml",
		embeddingScript: "/opt/p/packages/code-index/embedding_server.py",
		embeddingPort: 18742,
	};
	const processTable = [
		"201 /opt/p service/qdrant --config-path /agent/code-rag/qdrant/config.yaml --disable-telemetry",
		"202 /usr/bin/python /opt/p/packages/code-index/embedding_server.py --port 18742 --model test",
		"203 /usr/bin/python /opt/p/packages/code-index/embedding_server.py --port 8081 --model test",
		"204 /other/qdrant --config-path /agent/code-rag/qdrant/config.yaml --disable-telemetry",
		"205 /opt/p service/qdrant.bak --config-path /agent/code-rag/qdrant/config.yaml",
	].join("\n");

	assert.equal(isManagedBackendCommand(processTable.split("\n")[0], options), true);
	assert.deepEqual(selectManagedBackendPids(processTable, options), [201, 202]);
});

test("ships pinned Qdrant assets for macOS and Linux", () => {
	assert.ok(getQdrantAsset("darwin", "arm64"));
	assert.ok(getQdrantAsset("darwin", "x64"));
	assert.ok(getQdrantAsset("linux", "arm64"));
	assert.ok(getQdrantAsset("linux", "x64"));
});

test("selects the ROCm wheel index when Linux exposes an AMD compute device", () => {
	assert.deepEqual(
		selectTorchInstallPlan({
			platform: "linux",
			architecture: "x64",
			requestedBackend: "auto",
			hasAmdComputeDevice: true,
			hasNvidiaComputeDevice: false,
		}),
		{
			backend: "rocm",
			version: "2.12.1",
			indexUrl: "https://download.pytorch.org/whl/rocm7.2",
		},
	);
});

test("selects bounded CPU and CUDA builds for non-AMD Linux hosts", () => {
	assert.equal(
		selectTorchInstallPlan({
			platform: "linux",
			architecture: "x64",
			requestedBackend: "auto",
			hasAmdComputeDevice: false,
			hasNvidiaComputeDevice: false,
		}).backend,
		"cpu",
	);
	assert.equal(
		selectTorchInstallPlan({
			platform: "linux",
			architecture: "x64",
			requestedBackend: "auto",
			hasAmdComputeDevice: false,
			hasNvidiaComputeDevice: true,
		}).backend,
		"cuda",
	);
});

test("keeps the compatible native PyTorch build on Intel macOS", () => {
	assert.deepEqual(
		selectTorchInstallPlan({
			platform: "darwin",
			architecture: "x64",
			requestedBackend: "cpu",
		}),
		{
			backend: "default",
			version: "2.2.2",
			indexUrl: undefined,
		},
	);
});

test("rejects unsupported accelerator wheel targets", () => {
	assert.throws(
		() =>
			selectTorchInstallPlan({
				platform: "darwin",
				architecture: "arm64",
				requestedBackend: "rocm",
			}),
		/ROCm PyTorch is supported only on Linux x64/,
	);
	assert.throws(
		() =>
			selectTorchInstallPlan({
				platform: "linux",
				architecture: "x64",
				requestedBackend: "invalid",
			}),
		/P_CODE_RAG_TORCH_BACKEND/,
	);
});
