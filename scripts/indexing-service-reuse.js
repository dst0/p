#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isIndexingServiceReady, readEmbeddingHealth, readJson } from "./indexing-service-health.js";

const REUSE_DECISION_FILE = "indexing-version-unchanged";
const REUSE_DECISION_FORMAT_VERSION = 2;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const DAEMON = path.join(ROOT, "packages", "coding-agent", "dist", "indexing-service-daemon.js");

export function canReuseIndexingService({
  configuredDevice,
  denseEmbeddings,
  health,
  newIndexingVersion,
  newRuntimeConfigFingerprint,
  newRuntimeProvenance,
  status,
}) {
  if (!newIndexingVersion || status?.indexingVersion !== newIndexingVersion) return false;
  if (!hasMatchingRuntimeProvenance(status?.runtimeProvenance, newRuntimeProvenance)) return false;
  return isIndexingServiceReady({
    configuredDevice,
    denseEmbeddings,
    expectedFingerprint: newRuntimeConfigFingerprint,
    health,
    status,
  });
}

export function isIndexingServiceReuseDecisionCurrent({
  decision,
  currentIndexingVersion,
  currentRuntimeConfigFingerprint,
  currentRuntimeProvenance = getCurrentIndexingRuntimeProvenance(),
}) {
  return Boolean(
    decision &&
      decision.indexingVersion === currentIndexingVersion &&
      decision.runtimeConfigFingerprint === currentRuntimeConfigFingerprint &&
      hasMatchingRuntimeProvenance(decision.runtimeProvenance, currentRuntimeProvenance),
  );
}

export function assertIndexingServiceReuseDecisionCurrent({
  decision,
  currentIndexingVersion,
  currentRuntimeConfigFingerprint,
  currentRuntimeProvenance,
}) {
  if (!decision) return false;
  if (
    !isIndexingServiceReuseDecisionCurrent({
      decision,
      currentIndexingVersion,
      currentRuntimeConfigFingerprint,
      currentRuntimeProvenance,
    })
  ) {
    throw staleReuseDecisionError();
  }
  return true;
}

export function consumeExpectedIndexingServiceReuseDecision({
  agentDir,
  currentIndexingVersion,
  currentRuntimeConfigFingerprint,
  currentRuntimeProvenance,
  expectedReuse,
  expectedRunId,
}) {
  if (expectedReuse !== undefined && expectedReuse !== "reuse" && expectedReuse !== "restart") {
    throw new Error("Invalid indexing reinstall reuse expectation");
  }
  const decision = consumeIndexingServiceReuseDecision(agentDir, expectedRunId);
  if (expectedReuse === "reuse" && !decision) throw staleReuseDecisionError();
  if (expectedReuse === "restart" && decision) throw new Error("Unexpected indexing service reuse decision");
  assertIndexingServiceReuseDecisionCurrent({
    decision,
    currentIndexingVersion,
    currentRuntimeConfigFingerprint,
    currentRuntimeProvenance,
  });
  return decision;
}

export function writeIndexingServiceReuseDecision(
  agentDir,
  runId,
  indexingVersion,
  runtimeConfigFingerprint,
  runtimeProvenance = getCurrentIndexingRuntimeProvenance(),
) {
  validateRunId(runId);
  validateDigest(indexingVersion, "indexing version");
  validateDigest(runtimeConfigFingerprint, "runtime configuration fingerprint");
  validateRuntimeProvenance(runtimeProvenance);
  fs.mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  writePrivateJsonAtomic(path.join(agentDir, REUSE_DECISION_FILE), {
    formatVersion: REUSE_DECISION_FORMAT_VERSION,
    indexingVersion,
    runId,
    runtimeConfigFingerprint,
    runtimeProvenance,
  });
}

export function consumeIndexingServiceReuseDecision(agentDir, expectedRunId) {
  const decisionPath = path.join(agentDir, REUSE_DECISION_FILE);
  if (!fs.existsSync(decisionPath)) return undefined;
  let decision;
  try {
    const stat = fs.lstatSync(decisionPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("marker is not a regular file");
    decision = parseReuseDecision(fs.readFileSync(decisionPath, "utf8"));
  } catch (error) {
    fs.rmSync(decisionPath, { force: true });
    throw new Error("Invalid indexing service reuse decision", { cause: error });
  }
  if (decision.runId !== expectedRunId) {
    throw new Error("Indexing service reuse decision belongs to another reinstall run");
  }
  fs.rmSync(decisionPath, { force: true });
  return decision;
}

export function clearIndexingServiceReuseDecision(agentDir, expectedRunId) {
  const decisionPath = path.join(agentDir, REUSE_DECISION_FILE);
  if (!fs.existsSync(decisionPath)) return false;
  let decision;
  try {
    decision = parseReuseDecision(fs.readFileSync(decisionPath, "utf8"));
  } catch {
    if (expectedRunId !== undefined) return false;
  }
  if (expectedRunId !== undefined && decision?.runId !== expectedRunId) return false;
  fs.rmSync(decisionPath, { force: true });
  return true;
}

export async function inspectIndexingServiceReuse(agentDir, newIndexingVersion, newRuntimeConfigFingerprint) {
  const status = readJson(path.join(agentDir, "indexing-service-status.json"));
  const config = readJson(path.join(agentDir, "code-rag.json"));
  const denseEmbeddings = config?.searchMode !== "bm25-only";
  const health = denseEmbeddings ? await readEmbeddingHealth() : undefined;
  return canReuseIndexingService({
    configuredDevice: typeof config?.embeddingDevice === "string" ? config.embeddingDevice : undefined,
    denseEmbeddings,
    health,
    newIndexingVersion,
    newRuntimeConfigFingerprint,
    newRuntimeProvenance: getCurrentIndexingRuntimeProvenance(),
    status,
  });
}

async function runCli() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "--mark-reuse") {
    writeIndexingServiceReuseDecision(args[0], args[1], args[2], args[3]);
    return;
  }
  if (command === "--clear-reuse") {
    if (!clearIndexingServiceReuseDecision(args[0], args[1])) process.exitCode = 1;
    return;
  }
  const [newIndexingVersion, newRuntimeConfigFingerprint] = [command, ...args];
  const agentDir = process.env.P_CODING_AGENT_DIR ?? path.join(os.homedir(), ".p", "agent");
  const reusable = await inspectIndexingServiceReuse(agentDir, newIndexingVersion, newRuntimeConfigFingerprint);
  process.stdout.write(reusable ? "reuse" : "restart");
}

function parseReuseDecision(serialized) {
  const decision = JSON.parse(serialized);
  if (!decision || decision.formatVersion !== REUSE_DECISION_FORMAT_VERSION) {
    throw new Error("unsupported marker format");
  }
  validateRunId(decision.runId);
  validateDigest(decision.indexingVersion, "indexing version");
  validateDigest(decision.runtimeConfigFingerprint, "runtime configuration fingerprint");
  validateRuntimeProvenance(decision.runtimeProvenance);
  return decision;
}

export function getIndexingRuntimeProvenance(daemonPath, runtimeRoot) {
  if (typeof daemonPath !== "string" || typeof runtimeRoot !== "string") return undefined;
  try {
    const canonicalDaemonPath = fs.realpathSync(daemonPath);
    const canonicalRuntimeRoot = fs.realpathSync(runtimeRoot);
    const relativeDaemonPath = path.relative(canonicalRuntimeRoot, canonicalDaemonPath);
    if (
      relativeDaemonPath.length === 0 ||
      relativeDaemonPath === ".." ||
      relativeDaemonPath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeDaemonPath)
    ) {
      return undefined;
    }
    return { daemonPath: canonicalDaemonPath, runtimeRoot: canonicalRuntimeRoot };
  } catch {
    return undefined;
  }
}

export function getCurrentIndexingRuntimeProvenance() {
  return getIndexingRuntimeProvenance(DAEMON, ROOT);
}

function validateRunId(runId) {
  if (typeof runId !== "string" || runId.length === 0 || runId.length > 200) {
    throw new Error("Invalid indexing reinstall run id");
  }
}

function validateDigest(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`Invalid ${label}`);
}

function validateRuntimeProvenance(value) {
  if (!isRuntimeProvenance(value)) throw new Error("Invalid indexing runtime provenance");
}

function hasMatchingRuntimeProvenance(actual, expected) {
  return (
    isRuntimeProvenance(actual) &&
    isRuntimeProvenance(expected) &&
    actual.daemonPath === expected.daemonPath &&
    actual.runtimeRoot === expected.runtimeRoot
  );
}

function isRuntimeProvenance(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof value.daemonPath === "string" &&
    path.isAbsolute(value.daemonPath) &&
    typeof value.runtimeRoot === "string" &&
    path.isAbsolute(value.runtimeRoot)
  );
}

function writePrivateJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value)}\n`, { flag: "wx", mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

function staleReuseDecisionError() {
  return new Error("Indexing service reuse decision became stale; rerun ./reinstall.sh");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
