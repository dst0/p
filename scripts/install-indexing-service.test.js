import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  getSystemdUserUnitDirectory,
  isIndexingDaemonCommand,
  isManagedBackendCommand,
  renderLaunchdPlist,
  renderSystemdUnit,
  selectTorchInstallPlan,
  selectIndexingDaemonPids,
  selectManagedBackendPids,
} from "./install-indexing-service.js";
import { getQdrantAsset, getQdrantExtractionArgs } from "./indexing-qdrant-assets.js";
import {
  buildManagedIndexingConfig,
  persistManagedIndexingConfig,
  resolveManagedQdrantDataDirectory,
} from "./indexing-install-fallback.js";

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

test("allows full NPU model validation to finish during service startup", () => {
  const config = buildManagedIndexingConfig(
    {},
    {
      installAmdPhoenixIron: true,
      installAmdRyzenAi: false,
      installIntelOpenVino: false,
      ragDevice: "amd-phoenix-npu",
    },
    { backend: "cpu" },
    "/managed/venv/bin/python",
    "/managed/qdrant",
  );
  assert.equal(config.embeddingStartupTimeoutMs, 600_000);
  assert.equal(config.embeddingTimeoutMs, 600_000);
  assert.equal(config.searchTimeoutMs, 600_000);
});

test("preserves an explicitly configured Qdrant data directory", () => {
  const configuredDirectory = "/Volumes/fast-storage/p-qdrant";
  const config = buildManagedIndexingConfig(
    { qdrantDataDirectory: configuredDirectory },
    {
      installAmdPhoenixIron: false,
      installAmdRyzenAi: false,
      installIntelOpenVino: false,
      ragDevice: "mps",
    },
    { backend: "default" },
    "/managed/venv/bin/python",
    "/managed/qdrant",
  );

  assert.equal(config.qdrantDataDirectory, configuredDirectory);
});

test("uses the managed Qdrant default only when no data directory is configured", () => {
  const defaultDirectory = "/managed/default-qdrant";
  assert.equal(resolveManagedQdrantDataDirectory({}, defaultDirectory), defaultDirectory);
});

test("does not rewrite runtime configuration after reuse was approved", () => {
  const agentDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "p-indexing-config-"));
  const configPath = path.join(agentDirectory, "code-rag.json");
  const approvedConfig = { embeddingDevice: "mps", qdrantDataDirectory: "/custom/qdrant" };
  const managedConfig = { ...approvedConfig, qdrantDataDirectory: "/managed/default-qdrant" };
  try {
    fs.writeFileSync(configPath, `${JSON.stringify(approvedConfig, null, 2)}\n`, { mode: 0o600 });
    assert.deepEqual(persistManagedIndexingConfig(agentDirectory, managedConfig, true), approvedConfig);
    assert.deepEqual(JSON.parse(fs.readFileSync(configPath, "utf8")), approvedConfig);

    assert.deepEqual(persistManagedIndexingConfig(agentDirectory, managedConfig, false), managedConfig);
    assert.deepEqual(JSON.parse(fs.readFileSync(configPath, "utf8")), managedConfig);
  } finally {
    fs.rmSync(agentDirectory, { recursive: true, force: true });
  }
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
    embeddingScript: "/opt/p/packages/code-index/embedding_server.py",
    embeddingPort: 18742,
  };
  const processTable = [
    "201 /opt/p service/qdrant --config-path /agent/code-rag/qdrant/config.yaml --disable-telemetry",
    "202 /usr/bin/python /opt/p/packages/code-index/embedding_server.py --port 18742 --model test",
    "203 /usr/bin/python /opt/p/packages/code-index/embedding_server.py --port 8081 --model test",
    "204 /other/qdrant --config-path /agent/code-rag/qdrant/config.yaml --disable-telemetry",
    "205 /opt/p service/qdrant.bak --config-path /agent/code-rag/qdrant/config.yaml",
    "206 /opt/p service/qdrant --config-path /old-agent/code-rag/qdrant/config.yaml --disable-telemetry",
    "207 /usr/bin/node inspect.js /opt/p service/qdrant --config-path /agent/code-rag/qdrant/config.yaml",
  ].join("\n");

  assert.equal(isManagedBackendCommand(processTable.split("\n")[0].replace(/^\d+\s+/u, ""), options), true);
  assert.deepEqual(selectManagedBackendPids(processTable, options), [201, 202, 206]);
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
  assert.equal(
    selectTorchInstallPlan({
      platform: "linux",
      architecture: "x64",
      requestedBackend: "ryzenai",
    }).backend,
    "cpu",
  );
  assert.equal(
    selectTorchInstallPlan({
      platform: "linux",
      architecture: "x64",
      requestedBackend: "intel-openvino-npu",
    }).backend,
    "cpu",
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
    /torchBackend/,
  );
});

test("extracts Qdrant without applying archive ownership", () => {
  assert.deepEqual(getQdrantExtractionArgs("/tmp/qdrant.tar.gz", "/tmp/bin"), [
    "-xzf",
    "/tmp/qdrant.tar.gz",
    "--no-same-owner",
    "-C",
    "/tmp/bin",
  ]);
});

test("respects XDG_CONFIG_HOME for the systemd user unit", () => {
  assert.equal(getSystemdUserUnitDirectory("/tmp/xdg"), "/tmp/xdg/systemd/user");
});
