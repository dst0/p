import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";
import { requireCleanReleaseBenchmarkBase } from "../benchmarks/src/workloads/release-benchmark-base.ts";
import { readAndValidateBenchmarkArtifactPaths } from "./release-benchmark-artifacts.js";
import {
  persistBenchmarkEvidenceState,
  readBenchmarkEvidenceState,
} from "./release-benchmark-evidence-storage.js";

const SCHEMA_VERSION = 1;
const STATE_FILE = "p-release-benchmark-certification.json.br";
const MAX_CERTIFICATION_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;
const CANONICAL_AGENTS = ["p", "pi", "kilo"];
const CANONICAL_TASKS = [
  "typescript-calculator",
  "monolith-split",
  "event-sourced-inventory",
  "durable-workflow-saga",
];
const REQUIRED_BINDING_HASHES = [
  "candidateRuntimeSha256",
  "evaluatorSha256",
  "holdoutSha256",
  "kiloExecutableSha256",
  "modelConfigurationSha256",
  "nodeExecutableSha256",
  "piExecutableSha256",
  "projectInstructionsSha256",
];
function git(repoRoot, args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
function statePath(repoRoot) {
  const gitDirectory = git(repoRoot, ["rev-parse", "--git-common-dir"]);
  const absoluteGitDirectory = isAbsolute(gitDirectory) ? gitDirectory : resolve(repoRoot, gitDirectory);
  return resolve(absoluteGitDirectory, STATE_FILE);
}
function benchmarkPayload(receipt) {
  return {
    schemaVersion: receipt.schemaVersion,
    schemaName: receipt.schemaName,
    state: receipt.state,
    targetVersion: receipt.targetVersion,
    baseSha: receipt.baseSha,
    originMainSha: receipt.originMainSha,
    resultSha256: receipt.resultSha256,
    reportSha256: receipt.reportSha256,
    matrix: receipt.matrix,
    binding: receipt.binding,
    thresholds: receipt.thresholds,
    createdAt: receipt.createdAt,
  };
}

export function computeBenchmarkCertificationId(receipt) {
  return sha256(stableJson(benchmarkPayload(receipt)));
}

function assertHash(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value) || /^0+$/u.test(value)) {
    throw new Error(`Benchmark certification has invalid ${label}`);
  }
}

function assertCanonicalArray(actual, expected, label) {
  if (!Array.isArray(actual) || stableJson(actual) !== stableJson(expected)) {
    throw new Error(`Benchmark certification ${label} must be ${expected.join(", ")}`);
  }
}

function assertExactKeys(value, expected, label) {
  const actual = value && typeof value === "object" ? Object.keys(value).sort() : [];
  const canonical = [...expected].sort();
  if (stableJson(actual) !== stableJson(canonical)) {
    throw new Error(`Benchmark certification ${label} has an unexpected field set`);
  }
}

export function validateBenchmarkCertification(receipt, expected = {}) {
  if (!receipt || typeof receipt !== "object") throw new Error("Benchmark certification is missing");
  assertExactKeys(
    receipt,
    [
      "baseSha",
      "binding",
      "certificationId",
      "createdAt",
      "matrix",
      "originMainSha",
      "reportSha256",
      "resultSha256",
      "schemaName",
      "schemaVersion",
      "state",
      "targetVersion",
      "thresholds",
    ],
    "receipt",
  );
  if (receipt.schemaVersion !== SCHEMA_VERSION || receipt.schemaName !== "p-agent-benchmark-certification") {
    throw new Error("Benchmark certification schema is unsupported");
  }
  if (receipt.state !== "passed") throw new Error("Benchmark certification did not pass");
  for (const [field, value] of [
    ["target version", receipt.targetVersion],
    ["base SHA", receipt.baseSha],
    ["origin/main SHA", receipt.originMainSha],
  ]) {
    if (typeof value !== "string" || !value) throw new Error(`Benchmark certification is missing ${field}`);
  }
  if (expected.targetVersion && receipt.targetVersion !== expected.targetVersion) {
    throw new Error(`Benchmark certification target ${receipt.targetVersion} does not match ${expected.targetVersion}`);
  }
  if (expected.baseSha && receipt.baseSha !== expected.baseSha) {
    throw new Error("Benchmark certification base SHA does not match release main");
  }
  if (expected.originMainSha && receipt.originMainSha !== expected.originMainSha) {
    throw new Error("Benchmark certification origin/main SHA does not match release main");
  }
  if (!/^[a-f0-9]{40,64}$/u.test(receipt.baseSha) || !/^[a-f0-9]{40,64}$/u.test(receipt.originMainSha)) {
    throw new Error("Benchmark certification has an invalid Git SHA");
  }
  if (receipt.baseSha !== receipt.originMainSha) {
    throw new Error("Benchmark certification was not produced from exact origin/main");
  }
  assertHash(receipt.resultSha256, "result hash");
  assertHash(receipt.reportSha256, "report hash");
  assertExactKeys(
    receipt.matrix,
    ["agents", "cellCount", "expectedResolvedModel", "runs", "tasks"],
    "matrix",
  );
  assertCanonicalArray(receipt.matrix?.agents, CANONICAL_AGENTS, "agents");
  assertCanonicalArray(receipt.matrix?.tasks, CANONICAL_TASKS, "tasks");
  if (receipt.matrix?.runs !== 3 || receipt.matrix?.cellCount !== 36) {
    throw new Error("Benchmark certification requires exactly 3 runs and 36 cells");
  }
  if (typeof receipt.matrix?.expectedResolvedModel !== "string" || !receipt.matrix.expectedResolvedModel.trim()) {
    throw new Error("Benchmark certification is missing the resolved model identity");
  }
  assertExactKeys(receipt.binding, REQUIRED_BINDING_HASHES, "binding");
  for (const field of REQUIRED_BINDING_HASHES) assertHash(receipt.binding?.[field], `binding.${field}`);
  assertExactKeys(
    receipt.thresholds,
    ["maxCostRatio", "maxDurationRatio", "maxTokenRatio"],
    "thresholds",
  );
  for (const field of ["maxDurationRatio", "maxTokenRatio"]) {
    const value = receipt.thresholds?.[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1) {
      throw new Error(`Benchmark certification has invalid ${field}`);
    }
  }
  const maxCostRatio = receipt.thresholds?.maxCostRatio;
  if (
    maxCostRatio !== undefined &&
    maxCostRatio !== null &&
    (typeof maxCostRatio !== "number" || !Number.isFinite(maxCostRatio) || maxCostRatio <= 0 || maxCostRatio > 1)
  ) {
    throw new Error("Benchmark certification has invalid maxCostRatio");
  }
  const createdAt = typeof receipt.createdAt === "string" ? new Date(receipt.createdAt) : undefined;
  if (!createdAt || Number.isNaN(createdAt.valueOf()) || createdAt.toISOString() !== receipt.createdAt) {
    throw new Error("Benchmark certification has invalid creation time");
  }
  if (computeBenchmarkCertificationId(receipt) !== receipt.certificationId) {
    throw new Error("Benchmark certification integrity check failed");
  }
  return receipt;
}

export function persistBenchmarkCertification(repoRoot, evidence, artifacts) {
  const artifactBuffers = readAndValidateBenchmarkArtifactPaths(evidence, artifacts);
  const revision = requireCleanReleaseBenchmarkBase(repoRoot);
  const receipt = benchmarkPayload({
    ...evidence,
    schemaVersion: SCHEMA_VERSION,
    schemaName: "p-agent-benchmark-certification",
    state: "passed",
    baseSha: revision.headSha,
    originMainSha: revision.originMainSha,
  });
  receipt.certificationId = computeBenchmarkCertificationId(receipt);
  validateBenchmarkCertification(receipt, {
    targetVersion: evidence.targetVersion,
    baseSha: revision.headSha,
    originMainSha: revision.originMainSha,
  });
  const path = statePath(repoRoot);
  const temporaryPath = `${path}.${process.pid}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  const compressed = brotliCompressSync(Buffer.from(`${stableJson(receipt)}\n`), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 6 },
  });
  try {
    writeFileSync(temporaryPath, compressed, { mode: 0o600 });
    const finalRevision = requireCleanReleaseBenchmarkBase(repoRoot);
    if (finalRevision.headSha !== revision.headSha || finalRevision.originMainSha !== revision.originMainSha) {
      throw new Error("Benchmark certification Git revision changed during publication");
    }
    persistBenchmarkEvidenceState(repoRoot, receipt, artifactBuffers);
    renameSync(temporaryPath, path);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
  return receipt;
}

export function readBenchmarkCertification(repoRoot) {
  const path = statePath(repoRoot);
  if (!existsSync(path)) return null;
  return JSON.parse(brotliDecompressSync(readFileSync(path)).toString("utf8"));
}

export function assertFreshBenchmarkCertification(receipt, now = new Date()) {
  const createdAt = new Date(receipt.createdAt).valueOf();
  const age = now.valueOf() - createdAt;
  if (age < -MAX_FUTURE_CLOCK_SKEW_MS) {
    throw new Error("Benchmark certification creation time exceeds allowed future clock skew");
  }
  if (age > MAX_CERTIFICATION_AGE_MS) {
    throw new Error("Benchmark certification is older than 24 hours");
  }
}

export function requireBenchmarkCertification(repoRoot, targetVersion, revision) {
  const receipt = readBenchmarkCertification(repoRoot);
  if (!receipt) throw new Error("Major release requires a benchmark certification receipt");
  const validated = validateBenchmarkCertification(receipt, {
    targetVersion,
    baseSha: revision.headSha,
    originMainSha: revision.originMainSha,
  });
  assertFreshBenchmarkCertification(validated);
  readBenchmarkEvidenceState(repoRoot, validated);
  return validated;
}
