import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { BENCHMARK_PROJECT_INSTRUCTION_COMPILER_DIAGNOSTICS } from "./benchmark-project-instruction-diagnostics.js";
import { createBenchmarkAgentDirectories } from "./benchmark-agent-private-directories.js";
import { benchmarkSeedHelperPath } from "./benchmark-runtime-snapshot.js";
import { assertSeededManifestEvidence } from "./benchmark-project-instruction-seed-record.js";
import { sanitizeBenchmarkGitEnvironment } from "./benchmark-workspace-repository.js";

const SAFE_DIAGNOSTICS = new Set(BENCHMARK_PROJECT_INSTRUCTION_COMPILER_DIAGNOSTICS);
const SAFE_FAILURE_KINDS = new Set([
  "envelope",
  "root-schema",
  "constraint-set",
  "grounding-semantic",
  "provider",
]);
const BENCHMARK_SEED_FAILURES = new WeakMap();

export function certifyBenchmarkProjectInstructions(options) {
  const seedRoot = join(options.scratchRoot, "certified-project-instructions");
  mkdirSync(seedRoot, { recursive: true, mode: 0o700 });
  const seedPath = join(seedRoot, "seed.json");
  const certificatePath = join(seedRoot, "certificate.json");
  const agentDirectories = createBenchmarkAgentDirectories(
    { modelsFile: options.privateSnapshots.models.path, authFile: options.privateSnapshots.auth.path },
    options.scratchRoot,
  );
  const authPath = join(agentDirectories.dirs.p, "auth.json");
  try {
    options.authOutputGuard.capture(authPath);
    runHelper(
      benchmarkSeedHelperPath(options.runtimeSnapshot),
      [
        "certify",
        "--source",
        options.sourceFile,
        "--models-file",
        join(agentDirectories.dirs.p, "models.json"),
        "--auth-file",
        authPath,
        "--compiler-model",
        options.compilerModel,
        "--runtime-sha256",
        options.runtimeSha256,
        "--seed",
        seedPath,
        "--certificate",
        certificatePath,
      ],
      900_000,
    );
    options.authOutputGuard.capture(authPath);
    const certificate = JSON.parse(readFileSync(certificatePath, "utf8"));
    assertCertificate(certificate, options);
    return { seedPath, certificatePath, certificate };
  } finally {
    try {
      options.authOutputGuard.capture(authPath);
    } finally {
      agentDirectories.dispose();
    }
  }
}

export function materializeBenchmarkProjectInstructions(options) {
  const workspace = join(options.scratchOutput, "workspaces", "p", "run-1", options.task);
  const receiptPath = join(options.scratchOutput, "project-instruction-seed-receipt.json");
  runHelper(
    benchmarkSeedHelperPath(options.runtimeSnapshot),
    [
      "materialize",
      "--source",
      options.sourceFile,
      "--workspace",
      workspace,
      "--seed",
      options.seed.seedPath,
      "--certificate",
      options.seed.certificatePath,
      "--receipt",
      receiptPath,
    ],
    60_000,
  );
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  assertSeededManifestEvidence(
    {
      ...receipt.manifest,
      cacheClosureSha256: receipt.cacheClosureSha256,
      authorizedPromptHashes: receipt.authorizedPromptHashes,
    },
    receipt,
    options.seed.certificate,
  );
  return { receipt, path: receiptPath, sha256: hashFile(receiptPath) };
}

export function verifyBenchmarkProjectInstructionMaterialization(materialization) {
  if (!existsSync(materialization.path) || hashFile(materialization.path) !== materialization.sha256) {
    throw new Error("Project instruction seed receipt changed during the benchmark cell");
  }
}

export function assertLegacyCellUnseeded(scratchOutput, task) {
  const projectState = join(scratchOutput, "workspaces", "p", "run-1", task, ".pdev");
  if (existsSync(projectState)) throw new Error("Legacy benchmark cell unexpectedly contains seeded project state");
}

function runHelper(helper, args, timeout) {
  const env = { ...sanitizeBenchmarkGitEnvironment(), NO_COLOR: "1" };
  delete env.P_BENCHMARK_AUTH_FILE;
  const result = spawnSync(process.execPath, [helper, ...args], {
    env,
    encoding: "utf8",
    timeout,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status === 0) return;
  const failure = safeFailure(result.stdout);
  const error = new Error(failure?.diagnostic ?? `project instruction seed helper exited ${result.status ?? "without a status"}`);
  if (failure) BENCHMARK_SEED_FAILURES.set(error, failure);
  throw error;
}

export function getBenchmarkCompilerFailureTelemetry(error) {
  return getBenchmarkProjectInstructionSeedFailure(error)?.compilerFailure;
}

export function getBenchmarkProjectInstructionSeedFailure(error) {
  if (!(error instanceof Error)) return undefined;
  const failure = BENCHMARK_SEED_FAILURES.get(error);
  if (!failure) return undefined;
  return {
    diagnostic: failure.diagnostic,
    ...(failure.compilerFailure ? { compilerFailure: cloneCompilerFailure(failure.compilerFailure) } : {}),
  };
}

function safeFailure(stdout) {
  try {
    const lines = stdout.trim().split(/\r?\n/u);
    const parsed = JSON.parse(lines.at(-1));
    if (!isRecord(parsed) || parsed.status !== "failed" || !SAFE_DIAGNOSTICS.has(parsed.diagnostic)) return undefined;
    const hasCompilerFailure = Object.hasOwn(parsed, "compilerFailure");
    if (!hasExactKeys(parsed, hasCompilerFailure ? ["status", "diagnostic", "compilerFailure"] : ["status", "diagnostic"])) {
      return undefined;
    }
    const requiresCompilerFailure = [
      "project instruction compiler output validation failed",
      "project instruction compiler provider call failed",
      "project instruction compiler model context capacity was insufficient",
    ].includes(parsed.diagnostic);
    if (hasCompilerFailure !== requiresCompilerFailure) return undefined;
    const compilerFailure = hasCompilerFailure ? normalizeSafeCompilerFailure(parsed.compilerFailure) : undefined;
    if (hasCompilerFailure && !compilerFailure) return undefined;
    if (compilerFailure && !failureMatchesDiagnostic(compilerFailure, parsed.diagnostic)) return undefined;
    return { diagnostic: parsed.diagnostic, ...(compilerFailure ? { compilerFailure } : {}) };
  } catch {
    return undefined;
  }
}

function normalizeSafeCompilerFailure(value) {
  if (!isRecord(value) || !hasExactKeys(value, ["attemptCount", "failureKinds", "usage", "elapsedMs"])) return undefined;
  const usage = value?.usage;
  if (
    !Number.isInteger(value.attemptCount) ||
    value.attemptCount < 1 ||
    value.attemptCount > 2 ||
    !Array.isArray(value.failureKinds) ||
    value.failureKinds.length !== value.attemptCount ||
    !value.failureKinds.every((kind) => SAFE_FAILURE_KINDS.has(kind)) ||
    !isRecord(usage) ||
    !hasExactKeys(usage, ["input", "output", "cacheRead", "cacheWrite", "total"]) ||
    ![usage.input, usage.output, usage.cacheRead, usage.cacheWrite, usage.total].every(
      (amount) => Number.isFinite(amount) && amount >= 0,
    ) ||
    !Number.isFinite(value.elapsedMs) ||
    value.elapsedMs < 0
  ) {
    return undefined;
  }
  return cloneCompilerFailure(value);
}

function cloneCompilerFailure(value) {
  return {
    attemptCount: value.attemptCount,
    failureKinds: [...value.failureKinds],
    usage: {
      input: value.usage.input,
      output: value.usage.output,
      cacheRead: value.usage.cacheRead,
      cacheWrite: value.usage.cacheWrite,
      total: value.usage.total,
    },
    elapsedMs: value.elapsedMs,
  };
}

function failureMatchesDiagnostic(failure, diagnostic) {
  return failure.failureKinds.includes("provider")
    ? diagnostic === "project instruction compiler provider call failed" ||
        diagnostic === "project instruction compiler model context capacity was insufficient"
    : diagnostic === "project instruction compiler output validation failed";
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertCertificate(certificate, options) {
  const preparation = certificate?.compilerPreparation;
  if (
    certificate?.schemaVersion !== 1 ||
    preparation?.sourceSha256 !== options.sourceSha256 ||
    preparation?.modelsSha256 !== options.privateSnapshots.models.sha256 ||
    preparation?.runtimeSha256 !== options.runtimeSha256 ||
    `${preparation?.compilerModel?.provider}/${preparation?.compilerModel?.id}` !== options.compilerModel ||
    !Number.isFinite(preparation?.elapsedMs) ||
    preparation.elapsedMs <= 0 ||
    !Number.isFinite(preparation?.usage?.total) ||
    preparation.usage.total <= 0
  ) {
    throw new Error("Project instruction compiler certificate identity is invalid");
  }
}

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
