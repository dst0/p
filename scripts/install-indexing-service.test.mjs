import assert from "node:assert/strict";
import test from "node:test";
import {
	getQdrantAsset,
	isIndexingDaemonCommand,
	isManagedBackendCommand,
	renderLaunchdPlist,
	renderSystemdUnit,
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
