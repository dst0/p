import type { SeedPreparation } from "./seed-record.ts";
import { assertSeedCertificate } from "./seed-record.ts";

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
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

export function assertSeededManifestEvidence(manifest: unknown, receipt: unknown, certificate: unknown): void {
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
  let preparation: SeedPreparation;
  try {
    preparation = assertSeedCertificate(certificate).compilerPreparation;
  } catch {
    throw new Error("Seed materialization receipt does not match its certificate");
  }
  if (receipt.seedSha256 !== preparation.seedSha256 || receipt.certificationHash !== preparation.certificationHash) {
    throw new Error("Seed materialization receipt does not match its certificate");
  }
  if (!isRecord(manifest) || !isRecord(receipt.manifest)) {
    throw new Error("Seeded manifest evidence is missing");
  }
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
    if (manifest[field] !== receipt.manifest[field]) {
      throw new Error("Seeded cell manifest identity changed");
    }
  }
  if (
    manifest.compilerVersion !== preparation.compilerVersion ||
    manifest.mode !== "compiled" ||
    manifest.compilerStatus !== "success"
  ) {
    throw new Error("Seeded cell manifest does not match the certified compiler");
  }
}

function isManifestIdentity(value: unknown): value is Record<string, unknown> {
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

function isAuthorizedPromptHashes(value: unknown, canonicalPromptHash: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 16 &&
    value.every(isHash) &&
    new Set(value).size === value.length &&
    sameJson(value, [...value].sort()) &&
    typeof canonicalPromptHash === "string" &&
    !value.includes(canonicalPromptHash)
  );
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
