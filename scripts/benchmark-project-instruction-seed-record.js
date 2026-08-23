import { createHash } from "node:crypto";

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
const MANIFEST_IDENTITY_FIELDS = [
  "compilerVersion",
  "agentsHash",
  "inputHash",
  "resultHash",
  "promptHash",
  "rulesCatalogHash",
  "skillsCatalogHash",
  "mode",
  "compilerStatus",
];
const RECEIPT_FIELDS = [
  "schemaVersion",
  "seedSha256",
  "certificationHash",
  "providerCompilerInvocations",
  "seedMaterializations",
  "cacheClosureSha256",
  "authorizedPromptHashes",
  "manifest",
];

export function createCertifiedSeedRecord(input) {
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

export function assertCertifiedSeedRecord(value, expected) {
  if (!isRecord(value) || !hasExactKeys(value, SEED_FIELDS) || value.schemaVersion !== 1 || !isHash(value.certificationHash)) {
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
  return value;
}

export function createSeedCertificate(seed, seedSha256) {
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

export function assertSeededManifestEvidence(manifest, receipt, certificate) {
  const preparation = certificate?.compilerPreparation;
  if (
    !isRecord(receipt) ||
    receipt.schemaVersion !== 1 ||
    receipt.providerCompilerInvocations !== 0 ||
    receipt.seedMaterializations !== 1 ||
    !hasExactKeys(receipt, RECEIPT_FIELDS) ||
    !isHash(receipt.seedSha256) ||
    !isHash(receipt.certificationHash) ||
    !isHash(receipt.cacheClosureSha256) ||
    !isManifestIdentity(receipt.manifest) ||
    !isAuthorizedPromptHashes(receipt.authorizedPromptHashes, receipt.manifest.promptHash)
  ) {
    throw new Error("Seed materialization receipt is invalid");
  }
  if (
    !isRecord(certificate) ||
    certificate.schemaVersion !== 1 ||
    !hasExactKeys(certificate, ["schemaVersion", "compilerPreparation"]) ||
    !isRecord(preparation) ||
    !hasExactKeys(preparation, PREPARATION_FIELDS) ||
    !isHash(preparation.seedSha256) ||
    !isHash(preparation.certificationHash) ||
    !isHash(preparation.sourceSha256) ||
    !isHash(preparation.modelsSha256) ||
    !isHash(preparation.runtimeSha256) ||
    typeof preparation.compilerVersion !== "string" ||
    typeof preparation.compilerIdentity !== "string" ||
    !isModel(preparation.compilerModel) ||
    !isUsage(preparation.usage) ||
    !Number.isFinite(preparation.elapsedMs) ||
    preparation.elapsedMs <= 0 ||
    receipt.seedSha256 !== preparation.seedSha256 ||
    receipt.certificationHash !== preparation.certificationHash
  ) {
    throw new Error("Seed materialization receipt does not match its certificate");
  }
  if (!isRecord(manifest) || !isRecord(receipt.manifest)) throw new Error("Seeded manifest evidence is missing");
  if (!sameJson(manifest.authorizedPromptHashes, receipt.authorizedPromptHashes)) {
    throw new Error("Seeded cell prompt projection authority changed");
  }
  if (manifest.cacheClosureSha256 !== receipt.cacheClosureSha256) {
    throw new Error("Seeded cell cache closure changed after materialization");
  }
  if (manifest.compilerUsage !== undefined) {
    throw new Error("Seeded cell unexpectedly recorded a provider compiler invocation");
  }
  for (const field of MANIFEST_IDENTITY_FIELDS) {
    if (manifest[field] !== receipt.manifest[field]) throw new Error("Seeded cell manifest identity changed");
  }
  if (manifest.compilerVersion !== preparation.compilerVersion || manifest.mode !== "compiled" || manifest.compilerStatus !== "success") {
    throw new Error("Seeded cell manifest does not match the certified compiler");
  }
}

function isManifestIdentity(value) {
  return (
    isRecord(value) &&
    hasExactKeys(value, MANIFEST_IDENTITY_FIELDS) &&
    typeof value.compilerVersion === "string" &&
    [
      value.agentsHash,
      value.inputHash,
      value.resultHash,
      value.promptHash,
      value.rulesCatalogHash,
      value.skillsCatalogHash,
    ].every(isHash) &&
    value.mode === "compiled" &&
    value.compilerStatus === "success"
  );
}

function isAuthorizedPromptHashes(value, canonicalPromptHash) {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 16 &&
    value.every(isHash) &&
    new Set(value).size === value.length &&
    sameJson(value, [...value].sort()) &&
    !value.includes(canonicalPromptHash)
  );
}

function isCompilerResult(value) {
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

function isModel(value) {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["provider", "id", "api"]) &&
    [value.provider, value.id, value.api].every((entry) => typeof entry === "string")
  );
}

function isUsage(value) {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["input", "output", "cacheRead", "cacheWrite", "total"]) &&
    [value.input, value.output, value.cacheRead, value.cacheWrite, value.total].every(
      (entry) => typeof entry === "number" && Number.isFinite(entry) && entry >= 0,
    ) &&
    value.total > 0
  );
}

function pickModel(value) {
  return { provider: value?.provider, id: value?.id, api: value?.api };
}

function pickUsage(value) {
  return {
    input: value?.input,
    output: value?.output,
    cacheRead: value?.cacheRead,
    cacheWrite: value?.cacheWrite,
    total: value?.total,
  };
}

function isStringRecord(value) {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function isScopeRecord(value) {
  return isRecord(value) && Object.values(value).every((entry) => entry === "always-on" || entry === "routed");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  return sameJson(Object.keys(value).sort(), [...expected].sort());
}

function isHash(value) {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hashJson(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
