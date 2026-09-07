import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectInstructionCompilerResult } from "../../../packages/coding-agent/src/core/project-instructions/types.ts";
import { assertSeededManifestEvidence } from "../../src/project-instructions/seed-manifest.ts";
import {
  assertCertifiedSeedRecord,
  createCertifiedSeedRecord,
  createSeedCertificate,
} from "../../src/project-instructions/seed-record.ts";

const hash = (character: string): string => character.repeat(64);
const result: ProjectInstructionCompilerResult = {
  body: "Always preserve evidence.",
  triggers: { "1-rule": "code changes" },
  classifications: {
    modules: { "1-rule": "always-on" },
    constraints: { "constraint-1": "always-on" },
  },
  alwaysOn: { "constraint-1": "Always preserve evidence." },
};
const identity = {
  sourceSha256: hash("a"),
  modelsSha256: hash("b"),
  runtimeSha256: hash("c"),
  compilerVersion: "compiler-v1",
  compilerIdentity: "provider/model:contract-v1",
  compilerModel: { provider: "provider", id: "model", api: "custom-api" },
};

function seedRecord() {
  return createCertifiedSeedRecord({
    ...identity,
    result,
    usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, total: 120 },
    elapsedMs: 1234,
  });
}

test("certified seed binds source, model, compiler, runtime, result, usage, and timing", () => {
  const seed = seedRecord();
  assert.equal(assertCertifiedSeedRecord(seed, identity), seed);
  for (const mutation of [
    { sourceSha256: hash("d") },
    { modelsSha256: hash("d") },
    { runtimeSha256: hash("d") },
    { compilerVersion: "compiler-v2" },
    { compilerIdentity: "provider/model:contract-v2" },
    { compilerModel: { ...identity.compilerModel, id: "other" } },
    { result: { ...result, body: "Tampered." } },
    { usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 } },
    { elapsedMs: 2 },
  ]) {
    assert.throws(() => assertCertifiedSeedRecord({ ...seed, ...mutation }, identity), /certified seed/iu);
  }
});

test("safe certificate contains hashes and cold cost but no compiled source text", () => {
  const certificate = createSeedCertificate(seedRecord(), hash("e"));
  assert.deepEqual(certificate.compilerPreparation, {
    seedSha256: hash("e"),
    certificationHash: seedRecord().certificationHash,
    sourceSha256: hash("a"),
    modelsSha256: hash("b"),
    runtimeSha256: hash("c"),
    compilerVersion: "compiler-v1",
    compilerIdentity: "provider/model:contract-v1",
    compilerModel: identity.compilerModel,
    usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, total: 120 },
    elapsedMs: 1234,
  });
  assert.equal(JSON.stringify(certificate).includes(result.body), false);
});

test("seed and certificate boundaries exact-pick public model and usage fields", () => {
  const privateMarker = "private-seed-marker";
  const compilerModelWithPrivate = { ...identity.compilerModel, rawResponse: privateMarker };
  const usageWithPrivate = {
    input: 100,
    output: 20,
    cacheRead: 0,
    cacheWrite: 0,
    total: 120,
    source: privateMarker,
  };
  const seed = createCertifiedSeedRecord({
    ...identity,
    compilerModel: compilerModelWithPrivate,
    result,
    usage: usageWithPrivate,
    elapsedMs: 1234,
  });
  assert.equal(JSON.stringify(seed).includes(privateMarker), false);
  const certificate = createSeedCertificate(
    {
      ...seed,
      compilerModel: Object.assign({}, seed.compilerModel, { providerResponse: privateMarker }),
      usage: Object.assign({}, seed.usage, { args: privateMarker }),
    },
    hash("e"),
  );
  assert.equal(JSON.stringify(certificate).includes(privateMarker), false);
  assert.throws(() => assertCertifiedSeedRecord({ ...seed, rawResponse: privateMarker }, identity), /malformed/iu);
});

test("seeded cell evidence requires exact receipt identity and zero provider compiler usage", () => {
  const seed = seedRecord();
  const receipt = {
    schemaVersion: 1,
    seedSha256: hash("e"),
    certificationHash: seed.certificationHash,
    providerCompilerInvocations: 0,
    seedMaterializations: 1,
    cacheClosureSha256: hash("f"),
    authorizedPromptHashes: [hash("7")],
    manifest: {
      compilerVersion: identity.compilerVersion,
      agentsHash: hash("1"),
      inputHash: hash("2"),
      resultHash: hash("3"),
      promptHash: hash("4"),
      rulesCatalogHash: hash("5"),
      skillsCatalogHash: hash("6"),
      mode: "compiled",
      compilerStatus: "success",
    },
  };
  const evidence = {
    ...receipt.manifest,
    compilerUsage: undefined,
    cacheClosureSha256: receipt.cacheClosureSha256,
    authorizedPromptHashes: receipt.authorizedPromptHashes,
  };
  assert.doesNotThrow(() => assertSeededManifestEvidence(evidence, receipt, createSeedCertificate(seed, hash("e"))));
  const certificate = createSeedCertificate(seed, hash("e"));
  assert.throws(
    () => assertSeededManifestEvidence(evidence, receipt, { ...certificate, rawResponse: "private-marker" }),
    /certificate/iu,
  );
  assert.throws(
    () =>
      assertSeededManifestEvidence(evidence, receipt, {
        ...certificate,
        compilerPreparation: {
          ...certificate.compilerPreparation,
          compilerModel: { ...certificate.compilerPreparation.compilerModel, rawResponse: "private-marker" },
        },
      }),
    /certificate/iu,
  );
  assert.throws(
    () =>
      assertSeededManifestEvidence(
        { ...evidence, compilerUsage: { total: 1 } },
        receipt,
        createSeedCertificate(seed, hash("e")),
      ),
    /provider compiler/iu,
  );
  assert.throws(
    () =>
      assertSeededManifestEvidence(
        { ...evidence, promptHash: hash("0") },
        receipt,
        createSeedCertificate(seed, hash("e")),
      ),
    /manifest/iu,
  );
  assert.throws(
    () =>
      assertSeededManifestEvidence(
        evidence,
        { ...receipt, certificationHash: hash("0") },
        createSeedCertificate(seed, hash("e")),
      ),
    /certificate/iu,
  );
  assert.throws(
    () =>
      assertSeededManifestEvidence(
        { ...evidence, authorizedPromptHashes: [hash("8")] },
        receipt,
        createSeedCertificate(seed, hash("e")),
      ),
    /projection/iu,
  );

  const receiptMutations: Array<[string, (value: typeof receipt) => Record<string, unknown>]> = [
    ["empty", (value) => ({ ...value, authorizedPromptHashes: [] })],
    [
      "more than sixteen",
      (value) => ({
        ...value,
        authorizedPromptHashes: Array.from({ length: 17 }, (_, index) => index.toString(16).padStart(64, "0")),
      }),
    ],
    ["malformed hash", (value) => ({ ...value, authorizedPromptHashes: ["z".repeat(64)] })],
    ["duplicate", (value) => ({ ...value, authorizedPromptHashes: [hash("7"), hash("7")] })],
    ["unsorted", (value) => ({ ...value, authorizedPromptHashes: [hash("8"), hash("7")] })],
    ["canonical prompt", (value) => ({ ...value, authorizedPromptHashes: [value.manifest.promptHash] })],
    ["unknown field", (value) => ({ ...value, rawResponse: "private-marker" })],
  ];
  for (const [label, mutate] of receiptMutations) {
    assert.throws(
      () => assertSeededManifestEvidence(evidence, mutate(receipt), createSeedCertificate(seed, hash("e"))),
      /receipt is invalid/iu,
      label,
    );
  }
});
