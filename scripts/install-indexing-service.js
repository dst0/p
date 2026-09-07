#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  resolveFallbackDeviceChoices,
  resolveIndexingDevicePlan,
  selectTorchInstallPlan,
} from "./indexing-install-plans.js";
export {
  resolveFallbackDeviceChoices,
  resolveIndexingDevicePlan,
  selectTorchInstallPlan,
} from "./indexing-install-plans.js";
import { migrateLegacyIndexingConfig, readCodeRagConfig } from "./indexing-config.js";
import { detectAmdNpuPciDevices } from "./install-amd-ryzen-ai.js";
import { detectIntelNpuPciDevices } from "./install-intel-openvino-npu.js";
import { installPythonEnvironment } from "./indexing-python-environment.js";
import {
  buildManagedIndexingConfig,
  buildServiceValues,
  installSelectedNpuSystemRuntime,
  isTorchAcceleratorDevice,
  persistManagedIndexingConfig,
  promptForDeviceFallback,
  resolveManagedQdrantDataDirectory,
} from "./indexing-install-fallback.js";
import {
  assertIndexingServiceReuseDecisionCurrent,
  consumeExpectedIndexingServiceReuseDecision,
} from "./indexing-service-reuse.js";
import { findCompatiblePython } from "./indexing-python-discovery.js";
import { installAppleCoreAiRuntime, isMacOsCoreAiAvailable } from "./install-apple-coreai.js";
import { installIndexingTray } from "./build-indexing-tray.js";
import { computeIndexingRuntimeConfigFingerprint } from "../packages/coding-agent/dist/core/indexing-runtime-config.js";
import { computeIndexingVersion } from "../packages/coding-agent/dist/core/indexing-version.js";
import { getQdrantAsset, getQdrantExtractionArgs, QDRANT_VERSION } from "./indexing-qdrant-assets.js";

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
const EMBEDDING_SCRIPT = path.join(CODE_INDEX_DIR, "embedding_server.py");
const EMBEDDING_PORT = 18742;
const LOG_DIR = path.join(SERVICE_ROOT, "logs");
const STATUS_PATH = path.join(AGENT_DIR, "indexing-service-status.json");
const SERVICE_LABEL = "com.dst.p.code-index";
const LEGACY_SERVICE_LABEL = "com.dst.p.code-index-embedding";
const DRY_RUN = process.argv.includes("--dry-run");


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
    command.trimStart().startsWith(`${options.qdrantBinary} --config-path `) ||
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

async function main() {
  if (!getQdrantAsset()) {
    throw new Error(`Code indexing service is not supported on ${process.platform}/${process.arch}`);
  }
  const amdNpuDevices = process.platform === "linux" ? detectAmdNpuPciDevices() : [];
  const hasLinuxAmdNpuHardware = amdNpuDevices.length > 0;
  const amdNpuFamily = amdNpuDevices.some((device) => String(device.device).toLowerCase() === "0x1502")
    ? "phoenix"
    : "ryzenai";
  const hasLinuxIntelNpuHardware = process.platform === "linux" && detectIntelNpuPciDevices().length > 0;
  const hasMacOsCoreAi = isMacOsCoreAiAvailable();
  const reuseDecision = consumeExpectedIndexingServiceReuseDecision({
    agentDir: AGENT_DIR,
    currentIndexingVersion: computeIndexingVersion(ROOT),
    currentRuntimeConfigFingerprint: computeIndexingRuntimeConfigFingerprint(AGENT_DIR),
    expectedReuse: process.env.P_INDEXING_REINSTALL_EXPECTED_REUSE,
    expectedRunId: process.env.P_INDEXING_REINSTALL_RUN_ID,
  });
  let indexingConfig = migrateLegacyIndexingConfig(AGENT_DIR);
  const savedDevice = indexingConfig.embeddingDevice;
  const planOptions = {
    amdNpuFamily,
    architecture: process.arch,
    hasLinuxAmdNpuHardware,
    hasLinuxIntelNpuHardware,
    hasMacOsCoreAi,
    platform: process.platform,
  };
  let devicePlan;
  try {
    devicePlan = resolveIndexingDevicePlan({
      ...planOptions,
      savedDevice,
    });
  } catch (error) {
    const failedDevice = savedDevice ?? "npu";
    devicePlan = await promptForDeviceFallback(error, failedDevice, planOptions);
    indexingConfig = readCodeRagConfig(AGENT_DIR);
  }

  let python;
  let torchPlan;
  while (true) {
    try {
      installSelectedNpuSystemRuntime(devicePlan);
      python = findCompatiblePython({
        allowInstall: !DRY_RUN,
        requiredMinor: devicePlan.installAmdRyzenAi || devicePlan.installAmdPhoenixIron
          || devicePlan.installAppleCoreAi ? 12 : undefined,
      });
      torchPlan = selectTorchInstallPlan({
        requestedBackend:
          indexingConfig.torchBackend && indexingConfig.torchBackend !== "auto"
            ? indexingConfig.torchBackend
            : devicePlan.ragDevice,
      });
      break;
    } catch (error) {
      devicePlan = await promptForDeviceFallback(error, devicePlan.ragDevice, planOptions);
    }
  }
  const venvPython = path.join(VENV_DIR, "bin", "python");
  const qdrantBinary = path.join(BIN_DIR, "qdrant");

  if (DRY_RUN) {
    const values = buildServiceValues(devicePlan, venvPython);
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
  fs.mkdirSync(resolveManagedQdrantDataDirectory(indexingConfig), { recursive: true, mode: 0o700 });
  installIndexingTray(AGENT_DIR, CODE_INDEX_DIR, BIN_DIR, SERVICE_ROOT);
  await installQdrant(qdrantBinary);
  while (true) {
    try {
      installPythonEnvironment({
        agentDirectory: AGENT_DIR,
        installAmdPhoenixIron: devicePlan.installAmdPhoenixIron,
        installAmdRyzenAi: devicePlan.installAmdRyzenAi,
        installIntelOpenVino: devicePlan.installIntelOpenVino,
        python,
        requireTorchAccelerator: isTorchAcceleratorDevice(devicePlan.ragDevice),
        requirementsPath: REQUIREMENTS,
        ryzenAiArchivePath: indexingConfig.ryzenAiArchivePath,
        torchPlan,
        venvDirectory: VENV_DIR,
        venvPython,
      });
      if (devicePlan.installAppleCoreAi) {
        await installAppleCoreAiRuntime({
          agentDirectory: AGENT_DIR,
          codeIndexDirectory: CODE_INDEX_DIR,
          python: findCompatiblePython({ allowInstall: true, requiredMinor: 12 }),
        });
      }
      break;
    } catch (error) {
      devicePlan = await promptForDeviceFallback(error, devicePlan.ragDevice, planOptions);
      indexingConfig = readCodeRagConfig(AGENT_DIR);
      installSelectedNpuSystemRuntime(devicePlan);
      python = findCompatiblePython({
        allowInstall: true,
        requiredMinor: devicePlan.installAmdRyzenAi || devicePlan.installAmdPhoenixIron
          || devicePlan.installAppleCoreAi ? 12 : undefined,
      });
      torchPlan = selectTorchInstallPlan({
        requestedBackend:
          indexingConfig.torchBackend && indexingConfig.torchBackend !== "auto"
            ? indexingConfig.torchBackend
            : devicePlan.ragDevice,
      });
    }
  }
  const values = buildServiceValues(devicePlan, venvPython);
  indexingConfig = readCodeRagConfig(AGENT_DIR);
  const reuseApproved = assertIndexingServiceReuseDecisionCurrent({
    decision: reuseDecision,
    currentIndexingVersion: computeIndexingVersion(ROOT),
    currentRuntimeConfigFingerprint: computeIndexingRuntimeConfigFingerprint(AGENT_DIR),
  });
  persistManagedIndexingConfig(
    AGENT_DIR,
    buildManagedIndexingConfig(indexingConfig, devicePlan, torchPlan, venvPython, qdrantBinary),
    reuseApproved,
  );

  if (process.platform === "darwin") await installDarwin(renderLaunchdPlist(values), values.environment, reuseApproved);
  else await installLinux(renderSystemdUnit(values), values.environment, reuseApproved);
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

async function installDarwin(plist, environment, reuseApproved) {
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (uid === undefined) throw new Error("Unable to determine the current user id for launchd");
  const knownDaemonPid = readStatusDaemonPid();
  const launchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
  const plistPath = path.join(launchAgentsDir, `${SERVICE_LABEL}.plist`);
  const legacyPlistPath = path.join(launchAgentsDir, `${LEGACY_SERVICE_LABEL}.plist`);
  fs.mkdirSync(launchAgentsDir, { recursive: true });
  if (reuseApproved) {
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
  runRealSemanticSearchSmoke(environment);
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

async function installLinux(unit, environment, reuseApproved) {
  const knownDaemonPid = readStatusDaemonPid();
  const unitDirectory = getSystemdUserUnitDirectory();
  const unitPath = path.join(unitDirectory, `${SERVICE_LABEL}.service`);
  const legacyUnitPath = path.join(unitDirectory, `${LEGACY_SERVICE_LABEL}.service`);
  fs.mkdirSync(unitDirectory, { recursive: true });
  if (reuseApproved) {
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
  runRealSemanticSearchSmoke(environment);
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

function runRealSemanticSearchSmoke(environment) {
  console.log("Running real semantic-search verification");
  run(process.execPath, [SMOKE_SCRIPT], { env: { ...process.env, ...environment } });
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

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { env: options.env, stdio: options.allowFailure ? "ignore" : "inherit" });
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
