import { createHash } from "node:crypto";
import type { ProjectInstructionCompilerResult } from "../../../packages/coding-agent/src/core/project-instructions/types.ts";

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const SEED_FIELDS = [
  "schemaVersion",
  "sourceSha256",
  "modelsSha256",
  "runtimeSha256",
  "compilerVersion",
  "compilerIdentity",
  "compilerModel",
  "result",
  "usage",
  "elapsedMs",
  "certificationHash",
];
const PREPARATION_FIELDS = [
  "seedSha256",
  "certificationHash",
  "sourceSha256",
  "modelsSha256",
  "runtimeSha256",
  "compilerVersion",
  "compilerIdentity",
  "compilerModel",
  "usage",
  "elapsedMs",
];
export type CompilerModelIdentity = { provider: string; id: string; api: string };
export type CompilerUsage = { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
export type CertifiedSeedRecord = {
  schemaVersion: number;
  sourceSha256: string;
  modelsSha256: string;
  runtimeSha256: string;
  compilerVersion: string;
  compilerIdentity: string;
  compilerModel: CompilerModelIdentity;
  result: ProjectInstructionCompilerResult;
  usage: CompilerUsage;
  elapsedMs: number;
  certificationHash: string;
};

type SeedRecordInput = Omit<CertifiedSeedRecord, "schemaVersion" | "certificationHash">;
export type SeedRecordExpected = Pick<
  CertifiedSeedRecord,
  "sourceSha256" | "modelsSha256" | "runtimeSha256" | "compilerVersion" | "compilerIdentity" | "compilerModel"
>;
export type SeedPreparation = SeedRecordExpected & {
  seedSha256: string;
  certificationHash: string;
  usage: CompilerUsage;
  elapsedMs: number;
};
export type SeedCertificate = { schemaVersion: 1; compilerPreparation: SeedPreparation };

export function createCertifiedSeedRecord(input: SeedRecordInput): CertifiedSeedRecord {
  const unsigned = {
    schemaVersion: 1,
    sourceSha256: input.sourceSha256,
    modelsSha256: input.modelsSha256,
    runtimeSha256: input.runtimeSha256,
    compilerVersion: input.compilerVersion,
    compilerIdentity: input.compilerIdentity,
    compilerModel: pickModel(input.compilerModel),
    result: input.result,
    usage: pickUsage(input.usage),
    elapsedMs: input.elapsedMs,
  };
  return { ...unsigned, certificationHash: hashJson(unsigned) };
}

export function assertCertifiedSeedRecord(value: unknown, expected: SeedRecordExpected): CertifiedSeedRecord {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, SEED_FIELDS) ||
    value.schemaVersion !== 1 ||
    !isHash(value.certificationHash)
  ) {
    throw new Error("Certified seed record is malformed");
  }
  const unsigned = { ...value };
  delete unsigned.certificationHash;
  if (hashJson(unsigned) !== value.certificationHash) throw new Error("Certified seed hash is invalid");
  if (
    !isHash(value.sourceSha256) ||
    !isHash(value.modelsSha256) ||
    !isHash(value.runtimeSha256) ||
    typeof value.compilerVersion !== "string" ||
    typeof value.compilerIdentity !== "string" ||
    !isModel(value.compilerModel) ||
    !isCompilerResult(value.result) ||
    !isUsage(value.usage) ||
    typeof value.elapsedMs !== "number" ||
    !Number.isFinite(value.elapsedMs) ||
    value.elapsedMs <= 0
  ) {
    throw new Error("Certified seed record is malformed");
  }
  if (
    value.sourceSha256 !== expected.sourceSha256 ||
    value.modelsSha256 !== expected.modelsSha256 ||
    value.runtimeSha256 !== expected.runtimeSha256 ||
    value.compilerVersion !== expected.compilerVersion ||
    value.compilerIdentity !== expected.compilerIdentity ||
    !sameJson(value.compilerModel, expected.compilerModel)
  ) {
    throw new Error("Certified seed identity does not match the benchmark");
  }
  return value as CertifiedSeedRecord;
}

export function createSeedCertificate(seed: CertifiedSeedRecord, seedSha256: string): SeedCertificate {
  if (!isHash(seedSha256)) throw new Error("Certified seed file hash is invalid");
  return {
    schemaVersion: 1,
    compilerPreparation: {
      seedSha256,
      certificationHash: seed.certificationHash,
      sourceSha256: seed.sourceSha256,
      modelsSha256: seed.modelsSha256,
      runtimeSha256: seed.runtimeSha256,
      compilerVersion: seed.compilerVersion,
      compilerIdentity: seed.compilerIdentity,
      compilerModel: pickModel(seed.compilerModel),
      usage: pickUsage(seed.usage),
      elapsedMs: seed.elapsedMs,
    },
  };
}

export function assertSeedCertificate(value: unknown): SeedCertificate {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "compilerPreparation"]) ||
    value.schemaVersion !== 1 ||
    !isRecord(value.compilerPreparation) ||
    !hasExactKeys(value.compilerPreparation, PREPARATION_FIELDS)
  ) {
    throw new Error("Seed certificate is malformed");
  }
  const preparation = value.compilerPreparation;
  if (
    !isHash(preparation.seedSha256) ||
    !isHash(preparation.certificationHash) ||
    !isHash(preparation.sourceSha256) ||
    !isHash(preparation.modelsSha256) ||
    !isHash(preparation.runtimeSha256) ||
    typeof preparation.compilerVersion !== "string" ||
    typeof preparation.compilerIdentity !== "string" ||
    !isModel(preparation.compilerModel) ||
    !isUsage(preparation.usage) ||
    typeof preparation.elapsedMs !== "number" ||
    !Number.isFinite(preparation.elapsedMs) ||
    preparation.elapsedMs <= 0
  ) {
    throw new Error("Seed certificate is malformed");
  }
  return value as SeedCertificate;
}

function isCompilerResult(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.body === "string" &&
    isStringRecord(value.triggers) &&
    isRecord(value.classifications) &&
    isScopeRecord(value.classifications.modules) &&
    isScopeRecord(value.classifications.constraints) &&
    isStringRecord(value.alwaysOn)
  );
}

function isModel(value: unknown): value is CompilerModelIdentity {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["provider", "id", "api"]) &&
    [value.provider, value.id, value.api].every((entry) => typeof entry === "string")
  );
}

function isUsage(value: unknown): value is CompilerUsage {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["input", "output", "cacheRead", "cacheWrite", "total"]) &&
    [value.input, value.output, value.cacheRead, value.cacheWrite, value.total].every(
      (entry) => typeof entry === "number" && Number.isFinite(entry) && entry >= 0,
    ) &&
    typeof value.total === "number" &&
    value.total > 0
  );
}

function pickModel(value: CompilerModelIdentity): CompilerModelIdentity {
  return { provider: value.provider, id: value.id, api: value.api };
}

function pickUsage(value: CompilerUsage): CompilerUsage {
  return {
    input: value.input,
    output: value.output,
    cacheRead: value.cacheRead,
    cacheWrite: value.cacheWrite,
    total: value.total,
  };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function isScopeRecord(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every((entry) => entry === "always-on" || entry === "routed");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return sameJson(Object.keys(value).sort(), [...expected].sort());
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
