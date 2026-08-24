import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createBenchmarkAgentDirectories } from "../agents/private-directories.ts";
import { attachBenchmarkCleanupError, isBenchmarkInterruptedError } from "../harness/interruption.ts";
import { benchmarkSeedHelperPath } from "../harness/runtime-snapshot.ts";
import { runBenchmarkSeedHelper } from "../harness/seed-helper-process.ts";
import { sanitizeBenchmarkGitEnvironment } from "../harness/workspace-repository.ts";
import type { CompilerFailure, SeedFailure } from "./seed-failure.ts";
import { cloneSeedFailure, parseSafeSeedFailure } from "./seed-failure.ts";
import { assertSeededManifestEvidence } from "./seed-manifest.ts";
import type { SeedCertificate } from "./seed-record.ts";

export { runBenchmarkSeedHelper } from "../harness/seed-helper-process.ts";

type AuthOutputGuard = { capture(path: string): void };
type PrivateSnapshots = { models: { path: string; sha256: string }; auth: { path: string } };
type SeedRunControl = { signal?: AbortSignal; interruptionKillGraceMs?: number };
type CertificationOptions = SeedRunControl & {
  scratchRoot: string;
  sourceFile: string;
  compilerModel: string;
  runtimeSha256: string;
  runtimeSnapshot: string;
  privateSnapshots: PrivateSnapshots;
  authOutputGuard: AuthOutputGuard;
  sourceSha256: string;
};
type MaterializationOptions = SeedRunControl & {
  scratchOutput: string;
  task: string;
  sourceFile: string;
  runtimeSnapshot: string;
  seed: { seedPath: string; certificatePath: string; certificate: SeedCertificate };
};
type SeedMaterialization = {
  path: string;
  sha256: string;
  receipt: Record<string, unknown> & { cacheClosureSha256: string };
};
type SeedHelperResult = { status?: number; stdout: string };

const BENCHMARK_SEED_FAILURES = new WeakMap<Error, SeedFailure>();

function finalizeCertificationResources(
  authOutputGuard: AuthOutputGuard,
  authPath: string,
  agentDirectories: ReturnType<typeof createBenchmarkAgentDirectories>,
  primaryError: unknown,
): void {
  const cleanupErrors: unknown[] = [];
  try {
    authOutputGuard.capture(authPath);
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    agentDirectories.dispose();
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (cleanupErrors.length === 0) return;
  if (isBenchmarkInterruptedError(primaryError)) {
    for (const error of cleanupErrors) attachBenchmarkCleanupError(primaryError, error);
    throw primaryError;
  }
  throw new AggregateError(cleanupErrors, "Project instruction certification cleanup failed");
}

export async function certifyBenchmarkProjectInstructions(options: CertificationOptions) {
  const seedRoot = join(options.scratchRoot, "certified-project-instructions");
  mkdirSync(seedRoot, { recursive: true, mode: 0o700 });
  const seedPath = join(seedRoot, "seed.json");
  const certificatePath = join(seedRoot, "certificate.json");
  const agentDirectories = createBenchmarkAgentDirectories(
    { modelsFile: options.privateSnapshots.models.path, authFile: options.privateSnapshots.auth.path },
    options.scratchRoot,
  );
  const authPath = join(agentDirectories.dirs.p, "auth.json");
  let primaryError: unknown;
  try {
    options.authOutputGuard.capture(authPath);
    await runHelper(
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
      options,
    );
    options.authOutputGuard.capture(authPath);
    const certificate: unknown = JSON.parse(readFileSync(certificatePath, "utf8"));
    assertCertificate(certificate, options);
    return { seedPath, certificatePath, certificate };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    finalizeCertificationResources(options.authOutputGuard, authPath, agentDirectories, primaryError);
  }
}

export async function materializeBenchmarkProjectInstructions(
  options: MaterializationOptions,
): Promise<SeedMaterialization> {
  const workspace = join(options.scratchOutput, "workspaces", "p", "run-1", options.task);
  const receiptPath = join(options.scratchOutput, "project-instruction-seed-receipt.json");
  await runHelper(
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
    options,
  );
  const receipt: unknown = JSON.parse(readFileSync(receiptPath, "utf8"));
  if (!isRecord(receipt) || !isRecord(receipt.manifest) || typeof receipt.cacheClosureSha256 !== "string") {
    throw new Error("Project instruction seed receipt is malformed");
  }
  assertSeededManifestEvidence(
    {
      ...receipt.manifest,
      cacheClosureSha256: receipt.cacheClosureSha256,
      authorizedPromptHashes: receipt.authorizedPromptHashes,
    },
    receipt,
    options.seed.certificate,
  );
  return { receipt: receipt as SeedMaterialization["receipt"], path: receiptPath, sha256: hashFile(receiptPath) };
}

export function verifyBenchmarkProjectInstructionMaterialization(materialization: SeedMaterialization): void {
  if (!existsSync(materialization.path) || hashFile(materialization.path) !== materialization.sha256) {
    throw new Error("Project instruction seed receipt changed during the benchmark cell");
  }
}

export function assertLegacyCellUnseeded(scratchOutput: string, task: string): void {
  const projectState = join(scratchOutput, "workspaces", "p", "run-1", task, ".pdev");
  if (existsSync(projectState)) throw new Error("Legacy benchmark cell unexpectedly contains seeded project state");
}

async function runHelper(helper: string, args: string[], timeout: number, control: SeedRunControl): Promise<void> {
  const env: NodeJS.ProcessEnv = { ...sanitizeBenchmarkGitEnvironment(), NO_COLOR: "1" };
  delete env.P_BENCHMARK_AUTH_FILE;
  const result = (await runBenchmarkSeedHelper(helper, args, timeout, {
    env,
    signal: control.signal,
    killGraceMs: control.interruptionKillGraceMs,
  })) as SeedHelperResult;
  if (result.status === 0) return;
  const failure = parseSafeSeedFailure(result.stdout);
  const error = new Error(
    failure?.diagnostic ?? `project instruction seed helper exited ${result.status ?? "without a status"}`,
  );
  if (failure) BENCHMARK_SEED_FAILURES.set(error, failure);
  throw error;
}

export function getBenchmarkCompilerFailureTelemetry(error: unknown): CompilerFailure | undefined {
  return getBenchmarkProjectInstructionSeedFailure(error)?.compilerFailure;
}

export function getBenchmarkProjectInstructionSeedFailure(error: unknown): SeedFailure | undefined {
  if (!(error instanceof Error)) return undefined;
  const failure = BENCHMARK_SEED_FAILURES.get(error);
  if (!failure) return undefined;
  return cloneSeedFailure(failure);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertCertificate(
  certificate: unknown,
  options: CertificationOptions,
): asserts certificate is SeedCertificate {
  const preparation =
    isRecord(certificate) && isRecord(certificate.compilerPreparation) ? certificate.compilerPreparation : undefined;
  if (
    !isRecord(certificate) ||
    certificate.schemaVersion !== 1 ||
    !preparation ||
    preparation?.sourceSha256 !== options.sourceSha256 ||
    preparation?.modelsSha256 !== options.privateSnapshots.models.sha256 ||
    preparation?.runtimeSha256 !== options.runtimeSha256 ||
    !isRecord(preparation.compilerModel) ||
    `${preparation.compilerModel.provider}/${preparation.compilerModel.id}` !== options.compilerModel ||
    typeof preparation.elapsedMs !== "number" ||
    !Number.isFinite(preparation.elapsedMs) ||
    preparation.elapsedMs <= 0 ||
    !isRecord(preparation.usage) ||
    typeof preparation.usage.total !== "number" ||
    !Number.isFinite(preparation.usage.total) ||
    preparation.usage.total <= 0
  ) {
    throw new Error("Project instruction compiler certificate identity is invalid");
  }
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
