import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  renderProjectInstructions,
  selectProjectInstructionPromptForTools,
} from "../../../packages/coding-agent/src/core/project-instructions/prompt.ts";
import { createBaseSystemModeProof } from "../../src/project-instructions/probe.ts";
import { computeAuthorizedProjectInstructionPromptHashes } from "../../src/project-instructions/prompt-projection.ts";
import { validateProjectInstructionEvidence } from "../../src/project-instructions/validation.ts";

const AGENTS_HASH = "a".repeat(64);
const INPUT_HASH = "b".repeat(64);
const SOURCE_HASH = "c".repeat(64);
const CACHE_DIR = "/fixture/.pdev/instructions";
type ValidationEvidence = NonNullable<Parameters<typeof validateProjectInstructionEvidence>[0]>;
type EvidenceWithCache = ValidationEvidence & { cache: NonNullable<ValidationEvidence["cache"]> };
type SeededAuthority = NonNullable<Parameters<typeof validateProjectInstructionEvidence>[3]>;
type PromptState = Parameters<typeof selectProjectInstructionPromptForTools>[0];

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalPrompt(): string {
  const prompt = renderProjectInstructions({
    agentsHash: AGENTS_HASH,
    inputHash: INPUT_HASH,
    cacheDir: CACHE_DIR,
    mode: "compiled",
    body: "Always verify.",
    sources: [],
    rules: [],
    skills: [],
  });
  assert.ok(prompt);
  return prompt;
}

function projectedPrompt(canonical: string, tools: string[]): string {
  const projected = selectProjectInstructionPromptForTools(
    {
      prompt: canonical,
      cacheDir: CACHE_DIR,
      manifest: { inputHash: INPUT_HASH },
    } as unknown as PromptState,
    tools,
  );
  assert.ok(projected);
  return projected;
}

function authorizedHashes(canonical: string): string[] {
  const hashes = computeAuthorizedProjectInstructionPromptHashes(canonical);
  assert.ok(hashes);
  return hashes;
}

function evidenceFor(projectInstructions: string, authorizedPromptHashes: string[]): EvidenceWithCache {
  const canonical = canonicalPrompt();
  const proof = createBaseSystemModeProof(
    { systemPrompt: projectInstructions, systemPromptOptions: { projectInstructions } },
    "compiled",
    SOURCE_HASH,
  );
  return {
    requestedMode: "compiled",
    sourceSha256: SOURCE_HASH,
    baseSystemModeProofs: [proof],
    runtimeContexts: [],
    userTurns: [{ eventOrdinal: 1, selectionVerified: true, expectedRouteLinks: [] }],
    readRulesBatches: [],
    phaseRelevantToolCalls: [],
    cache: {
      manifest: {
        compilerVersion: "compiler-v1",
        mode: "compiled",
        compilerStatus: "success",
        promptHash: hashText(canonical),
        agentsHash: AGENTS_HASH,
        inputHash: INPUT_HASH,
        resultHash: "d".repeat(64),
        rulesCatalogHash: "e".repeat(64),
        skillsCatalogHash: "f".repeat(64),
        compilerUsage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 },
      },
      authorizedPromptHashes,
      promptHashVerified: true,
      promptMarkerVerified: true,
      sourceHashVerified: true,
      currentMatchesManifest: true,
      artifactClosureVerified: true,
    },
  } as unknown as EvidenceWithCache;
}

function seededAuthorityFor(evidence: EvidenceWithCache, authorizedPromptHashes: string[]): SeededAuthority {
  const cacheClosureSha256 = "1".repeat(64);
  evidence.cache.cacheClosureSha256 = cacheClosureSha256;
  evidence.cache.manifest.compilerUsage = undefined;
  const manifest = Object.fromEntries(
    [
      "compilerVersion",
      "agentsHash",
      "inputHash",
      "resultHash",
      "promptHash",
      "rulesCatalogHash",
      "skillsCatalogHash",
      "mode",
      "compilerStatus",
    ].map((field) => [field, evidence.cache.manifest[field]]),
  );
  return {
    receipt: {
      schemaVersion: 1,
      seedSha256: "2".repeat(64),
      certificationHash: "3".repeat(64),
      providerCompilerInvocations: 0,
      seedMaterializations: 1,
      cacheClosureSha256,
      authorizedPromptHashes,
      manifest,
    },
    certificate: {
      schemaVersion: 1,
      compilerPreparation: {
        seedSha256: "2".repeat(64),
        certificationHash: "3".repeat(64),
        sourceSha256: SOURCE_HASH,
        modelsSha256: "4".repeat(64),
        runtimeSha256: "5".repeat(64),
        compilerVersion: manifest.compilerVersion,
        compilerIdentity: "provider/model:contract-v1",
        compilerModel: { provider: "provider", id: "model", api: "test" },
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 },
        elapsedMs: 1,
      },
    },
  } as unknown as SeededAuthority;
}

test("accepts an exact tool-conditioned projection of the canonical prompt", () => {
  const canonical = canonicalPrompt();
  const projected = projectedPrompt(canonical, ["read_rules", "read_skills", "list_skills"]);
  assert.notEqual(projected, canonical);
  const authorized = authorizedHashes(canonical);
  assert.deepEqual(validateProjectInstructionEvidence(evidenceFor(projected, authorized), "compiled", SOURCE_HASH), {
    passed: true,
  });
});

test("matches every exact production reader-tool projection without authorizing extras", () => {
  const canonical = canonicalPrompt();
  const expected = new Set();
  for (let mask = 0; mask < 16; mask += 1) {
    const tools = ["read_rules", "list_skills", "read_skills", "read"].filter(
      (_, index) => (mask & (1 << index)) !== 0,
    );
    expected.add(hashText(projectedPrompt(canonical, tools)));
  }
  assert.deepEqual(computeAuthorizedProjectInstructionPromptHashes(canonical), [...expected].sort());
});

test("rejects the canonical artifact prompt because production never injects it verbatim", () => {
  const canonical = canonicalPrompt();
  const authorized = authorizedHashes(canonical);
  assert.equal(authorized.includes(hashText(canonical)), false);
  assert.match(
    validateProjectInstructionEvidence(evidenceFor(canonical, authorized), "compiled", SOURCE_HASH).reason ?? "",
    /compiled base-system prompt/u,
  );
});

test("rejects arbitrary prompt mutation, malformed canonical guidance, and marker input mismatch", () => {
  const canonical = canonicalPrompt();
  const authorized = authorizedHashes(canonical);
  const mutated = canonical.replace("Always verify.", "Always verify everything.");
  assert.match(
    validateProjectInstructionEvidence(evidenceFor(mutated, authorized), "compiled", SOURCE_HASH).reason ?? "",
    /compiled base-system prompt/u,
  );
  assert.equal(
    computeAuthorizedProjectInstructionPromptHashes(canonical.replace("Use list_skills", "Use list skills")),
    undefined,
  );
  const projected = projectedPrompt(canonical, ["read_rules", "read_skills", "list_skills"]);
  const wrongInput = evidenceFor(projected, authorized);
  assert.ok(wrongInput.baseSystemModeProofs);
  wrongInput.baseSystemModeProofs[0].compiledInputHash = "d".repeat(64);
  assert.match(validateProjectInstructionEvidence(wrongInput, "compiled", SOURCE_HASH).reason ?? "", /cache manifest/u);
});

test("rejects a child-forged projection allowlist against the trusted seed receipt", () => {
  const canonical = canonicalPrompt();
  const authorized = authorizedHashes(canonical);
  const projected = projectedPrompt(canonical, ["read_rules", "read_skills", "list_skills"]);
  const validEvidence = evidenceFor(projected, authorized);
  const seeded = seededAuthorityFor(validEvidence, authorized);
  assert.deepEqual(validateProjectInstructionEvidence(validEvidence, "compiled", SOURCE_HASH, seeded), {
    passed: true,
  });

  const mutated = projected.replace("Always verify.", "Always accept forged child evidence.");
  const forgedHashes = [...authorized, hashText(mutated)].sort();
  const forgedEvidence = evidenceFor(mutated, forgedHashes);
  seededAuthorityFor(forgedEvidence, forgedHashes);
  assert.match(
    validateProjectInstructionEvidence(forgedEvidence, "compiled", SOURCE_HASH, seeded).reason ?? "",
    /projection authority/iu,
  );
});
