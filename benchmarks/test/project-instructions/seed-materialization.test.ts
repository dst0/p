import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { AuthStorage } from "../../../packages/coding-agent/dist/core/auth-storage.js";
import { ModelRegistry } from "../../../packages/coding-agent/dist/core/model-registry.js";
import { buildProjectInstructionCompilerModelIdentity } from "../../../packages/coding-agent/dist/core/project-instructions/compiler-reasoning-control.js";
import {
  PROJECT_INSTRUCTION_COMPILER_VERSION,
  prepareProjectInstructions,
} from "../../../packages/coding-agent/dist/core/project-instructions/processor.js";
import { DEFAULT_MODEL_COMPILER_CONTRACT_REVISION } from "../../../packages/coding-agent/dist/core/project-instructions/session-controller.js";
import { captureVerifiedCompiledCache } from "../../src/project-instructions/cache.ts";
import { assertSeededManifestEvidence } from "../../src/project-instructions/seed-manifest.ts";
import {
  assertLegacyCellUnseeded,
  materializeBenchmarkProjectInstructions,
  verifyBenchmarkProjectInstructionMaterialization,
} from "../../src/project-instructions/seed-runner.ts";
import { createSeedMaterializationFixture, materializeSeedFixture } from "./seed-materialization-fixture.ts";

const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

test("materializer creates a path-correct provider-free cache bound to the certified seed", () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-seed-materialize-"));
  try {
    const fixture = createSeedMaterializationFixture(root);
    const execution = materializeSeedFixture(fixture);
    assert.equal(execution.status, 0, execution.stdout);
    const receipt = JSON.parse(readFileSync(fixture.receiptPath, "utf8"));
    const captured = captureVerifiedCompiledCache(fixture.workspace, fixture.sourceSha256);
    assert.ok(captured);
    const cache = captured.evidence;
    assert.equal(cache.manifest.compilerUsage, undefined);
    assert.equal(receipt.providerCompilerInvocations, 0);
    assert.equal(receipt.seedMaterializations, 1);
    assertSeededManifestEvidence(
      {
        ...cache.manifest,
        cacheClosureSha256: cache.cacheClosureSha256,
        authorizedPromptHashes: cache.authorizedPromptHashes,
      },
      receipt,
      fixture.certificate,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("live compiler identity reuses the exact seed cache without invoking the provider", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-seed-live-reuse-"));
  try {
    const fixture = createSeedMaterializationFixture(root);
    const execution = materializeSeedFixture(fixture);
    assert.equal(execution.status, 0, execution.stdout);
    const before = captureVerifiedCompiledCache(fixture.workspace, fixture.sourceSha256);
    assert.ok(before);
    const registry = ModelRegistry.create(AuthStorage.inMemory(), fixture.modelsPath);
    const model = registry.find("provider", "model");
    assert.ok(model);
    const liveIdentity = buildProjectInstructionCompilerModelIdentity(model, DEFAULT_MODEL_COMPILER_CONTRACT_REVISION);
    assert.equal(liveIdentity, fixture.compilerIdentity);
    const agentsPath = join(fixture.workspace, "AGENTS.md");
    const content = readFileSync(agentsPath, "utf8");
    let compilerCalls = 0;
    await prepareProjectInstructions({
      cwd: fixture.workspace,
      cacheDir: join(fixture.workspace, ".pdev", "instructions"),
      contextFiles: [{ path: agentsPath, content }],
      skills: [],
      compilerIdentity: liveIdentity,
      compiler: async () => {
        compilerCalls += 1;
        return fixture.result;
      },
    });
    assert.equal(compilerCalls, 0);
    const after = captureVerifiedCompiledCache(fixture.workspace, fixture.sourceSha256);
    assert.ok(after);
    assert.equal(after.evidence.cacheClosureSha256, before.evidence.cacheClosureSha256);
    assert.deepEqual(after.evidence.authorizedPromptHashes, before.evidence.authorizedPromptHashes);

    const changedIdentity = buildProjectInstructionCompilerModelIdentity(
      { ...model, reasoning: !model.reasoning },
      DEFAULT_MODEL_COMPILER_CONTRACT_REVISION,
    );
    await prepareProjectInstructions({
      cwd: fixture.workspace,
      cacheDir: join(fixture.workspace, ".pdev", "instructions"),
      contextFiles: [{ path: agentsPath, content }],
      skills: [],
      compilerIdentity: changedIdentity,
      compiler: async () => {
        compilerCalls += 1;
        return fixture.result;
      },
    });
    assert.equal(compilerCalls, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("materializer rejects stale compiler, model-contract identity, and source without publishing cache", () => {
  for (const kind of ["compiler", "identity", "source"]) {
    const root = mkdtempSync(join(tmpdir(), "p-benchmark-seed-reject-"));
    try {
      const fixture = createSeedMaterializationFixture(
        root,
        kind === "compiler"
          ? "project-instructions-v4-exact-source-v9-global-provider-context"
          : PROJECT_INSTRUCTION_COMPILER_VERSION,
        kind === "identity" ? "provider/model:exact-source-v7-global-boundaries" : undefined,
      );
      if (kind === "source") writeFileSync(fixture.sourcePath, `${readFileSync(fixture.sourcePath, "utf8")}changed\n`);
      const execution = materializeSeedFixture(fixture);
      assert.equal(execution.status, 86, execution.stderr);
      assert.throws(() => readFileSync(fixture.receiptPath), /ENOENT/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("one immutable certificate seeds repeated compiled cells while legacy remains unseeded", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-seed-repeated-"));
  try {
    const fixture = createSeedMaterializationFixture(root);
    const seedSha256 = sha256(readFileSync(fixture.seedPath));
    const receipts = await Promise.all(
      Array.from({ length: 3 }, (_, index) =>
        materializeBenchmarkProjectInstructions({
          runtimeSnapshot: fileURLToPath(new URL("../../..", import.meta.url)),
          sourceFile: fixture.sourcePath,
          modelsFile: fixture.modelsPath,
          scratchOutput: join(root, `cell-${index}`),
          task: "task",
          seed: {
            seedPath: fixture.seedPath,
            certificatePath: fixture.certificatePath,
            certificate: fixture.certificate,
          },
        }),
      ),
    );
    assert.equal(new Set(receipts.map(({ receipt }) => receipt.certificationHash)).size, 1);
    assert.deepEqual(
      receipts.map(({ receipt }) => receipt.providerCompilerInvocations),
      [0, 0, 0],
    );
    receipts.forEach(verifyBenchmarkProjectInstructionMaterialization);
    writeFileSync(receipts[0].path, "{}\n");
    assert.throws(() => verifyBenchmarkProjectInstructionMaterialization(receipts[0]), /receipt changed/u);
    assert.equal(sha256(readFileSync(fixture.seedPath)), seedSha256);
    const legacyRoot = join(root, "legacy");
    assert.doesNotThrow(() => assertLegacyCellUnseeded(legacyRoot, "task"));
    mkdirSync(join(legacyRoot, "workspaces", "p", "run-1", "task", ".pdev"), { recursive: true });
    assert.throws(() => assertLegacyCellUnseeded(legacyRoot, "task"), /unexpectedly contains seeded/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
