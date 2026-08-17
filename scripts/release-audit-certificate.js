import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";

import { createReleaseAuditEvidence } from "./release-audit-evidence.js";
import { computeReleaseInputHash, releaseInputPaths } from "./release-inputs.js";
import { assertReleaseTargetVersion } from "./release-target-policy.js";

const SCHEMA_VERSION = 1;
const STATE_FILE = "p-release-audit-state.json.br";
const ACTIVE_RELEASE_STATES = new Set([
  "release_in_progress",
  "version_bump_in_progress",
  "version_bumped",
  "artifacts_ready",
  "checks_passed",
  "release_committed",
  "tagged",
  "next_cycle_committed",
  "failed",
]);

function git(repoRoot, args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? "null" : stableJson(item))).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function statePath(repoRoot) {
  const gitPath = git(repoRoot, ["rev-parse", "--git-path", STATE_FILE]);
  return isAbsolute(gitPath) ? gitPath : resolve(repoRoot, gitPath);
}

export function writeReleaseAuditState(repoRoot, state) {
  const path = statePath(repoRoot);
  const temporaryPath = `${path}.${process.pid}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  const compressed = brotliCompressSync(Buffer.from(`${stableJson(state)}\n`), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 6 },
  });
  try {
    writeFileSync(temporaryPath, compressed, { mode: 0o600 });
    renameSync(temporaryPath, path);
  } finally {
    if (existsSync(temporaryPath)) {
      unlinkSync(temporaryPath);
    }
  }
  return state;
}

export function readReleaseAuditState(repoRoot) {
  const path = statePath(repoRoot);
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(brotliDecompressSync(readFileSync(path)).toString("utf8"));
}

function currentVersion(repoRoot) {
  return JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).version;
}

function assertTarget(repoRoot, targetVersion) {
  const version = currentVersion(repoRoot);
  assertReleaseTargetVersion(version, targetVersion);
}

function currentRevision(repoRoot) {
  return {
    headSha: git(repoRoot, ["rev-parse", "HEAD"]),
    originMainSha: git(repoRoot, ["rev-parse", "refs/remotes/origin/main"]),
  };
}

function assertCleanMain(repoRoot) {
  const revision = currentRevision(repoRoot);
  if (revision.headSha !== revision.originMainSha) {
    throw new Error(`HEAD ${revision.headSha} must equal origin/main ${revision.originMainSha}`);
  }
  if (git(repoRoot, ["status", "--porcelain"])) {
    throw new Error("Release audit requires a clean worktree");
  }
  return revision;
}

export function releaseCertificatePayload(state) {
  return {
    schemaVersion: state.schemaVersion,
    baseSha: state.baseSha,
    originMainSha: state.originMainSha,
    targetVersion: state.targetVersion,
    inputHash: state.inputHash,
    inputPaths: state.inputPaths,
    evidenceHash: state.evidenceHash,
  };
}

export function computeReleaseCertificateId(state) {
  return sha256(stableJson(releaseCertificatePayload(state)));
}

export function computeReleaseEvidenceHash(evidence) {
  return sha256(stableJson(evidence));
}

function invalid(reason) {
  return { valid: false, reason };
}

export function markReleaseCertificateStale(repoRoot, reason) {
  const state = readReleaseAuditState(repoRoot);
  if (!state || state.state !== "certified") {
    return state;
  }
  return writeReleaseAuditState(repoRoot, {
    ...state,
    state: "stale",
    staleReason: reason,
    invalidatedAt: new Date().toISOString(),
  });
}

export function certifyReleaseAudit(repoRoot, targetVersion) {
  const previous = readReleaseAuditState(repoRoot);
  if (previous && ACTIVE_RELEASE_STATES.has(previous.state)) {
    throw new Error(`Cannot replace release audit while state is ${previous.state}`);
  }
  assertTarget(repoRoot, targetVersion);
  const revision = assertCleanMain(repoRoot);
  const evidence = createReleaseAuditEvidence(repoRoot, targetVersion);
  const evidenceHash = computeReleaseEvidenceHash(evidence);
  const evidenceReady = writeReleaseAuditState(repoRoot, {
    schemaVersion: SCHEMA_VERSION,
    state: "evidence_ready",
    baseSha: revision.headSha,
    originMainSha: revision.originMainSha,
    targetVersion,
    inputHash: computeReleaseInputHash(repoRoot),
    inputPaths: releaseInputPaths(repoRoot),
    evidenceHash,
    evidence,
    auditedAt: new Date().toISOString(),
  });
  const certificateId = computeReleaseCertificateId(evidenceReady);
  return writeReleaseAuditState(repoRoot, { ...evidenceReady, state: "certified", certificateId });
}

export function inspectReleaseCertificate(repoRoot, targetVersion) {
  const state = readReleaseAuditState(repoRoot);
  if (!state) {
    return { valid: false, reason: "No release audit certificate exists" };
  }
  if (state.state !== "certified") {
    return { valid: false, reason: `Release audit state is ${state.state}, not certified` };
  }
  if (state.schemaVersion !== SCHEMA_VERSION) {
    return invalid(`Unsupported release audit schema ${state.schemaVersion}`);
  }
  if (state.targetVersion !== targetVersion) {
    return invalid(`Certificate target ${state.targetVersion} does not match ${targetVersion}`);
  }
  const revision = currentRevision(repoRoot);
  if (revision.headSha !== state.baseSha || revision.originMainSha !== state.originMainSha || revision.headSha !== revision.originMainSha) {
    return invalid("HEAD or origin/main changed after the changelog audit");
  }
  const inputHash = computeReleaseInputHash(repoRoot);
  if (inputHash !== state.inputHash) {
    return invalid("Release input hash changed after the changelog audit");
  }
  if (computeReleaseEvidenceHash(state.evidence) !== state.evidenceHash) {
    return invalid("Stored changelog audit evidence was modified");
  }
  if (computeReleaseCertificateId(state) !== state.certificateId) {
    return invalid("Release audit certificate integrity check failed");
  }
  return { valid: true, state };
}

export { assertCleanMain, currentRevision };
