import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildProjectInstructionConstraints } from "../packages/coding-agent/dist/core/project-instructions/compiler-constraints.js";
import { splitInstructionSources } from "../packages/coding-agent/dist/core/project-instructions/content.js";
import { materializeProjectInstructionCompilerResult } from "../packages/coding-agent/dist/core/project-instructions/compiler-validation.js";
import { PROJECT_INSTRUCTION_COMPILER_VERSION } from "../packages/coding-agent/dist/core/project-instructions/processor.js";
import { DEFAULT_MODEL_COMPILER_CONTRACT_REVISION } from "../packages/coding-agent/dist/core/project-instructions/session-controller.js";
import { captureVerifiedCompiledCache } from "./benchmark-project-instruction-cache.js";
import { createBenchmarkGateFailure } from "./benchmark-project-instruction-failure.js";
import {
  assertSeededManifestEvidence,
  createCertifiedSeedRecord,
  createSeedCertificate,
} from "./benchmark-project-instruction-seed-record.js";
import {
  assertLegacyCellUnseeded,
  certifyBenchmarkProjectInstructions,
  getBenchmarkCompilerFailureTelemetry,
  materializeBenchmarkProjectInstructions,
  verifyBenchmarkProjectInstructionMaterialization,
} from "./benchmark-project-instruction-seed-runner.js";

const helper = new URL("./benchmark-project-instruction-seed.js", import.meta.url);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function createFixture(
  root,
  compilerVersion = PROJECT_INSTRUCTION_COMPILER_VERSION,
  compilerIdentity = `provider/model:${DEFAULT_MODEL_COMPILER_CONTRACT_REVISION}`,
) {
  const content = `# Rules\n${Array.from({ length: 240 }, (_, index) => `- When code changes, run focused check ${index}.`).join("\n")}\n`;
  const sourcePath = join(root, "source-AGENTS.md");
  const workspace = join(root, "workspace");
  const seedPath = join(root, "seed.json");
  const certificatePath = join(root, "certificate.json");
  const receiptPath = join(root, "receipt.json");
  writeFileSync(sourcePath, content, { mode: 0o600 });
  const sources = [{ path: sourcePath, content }];
  const modules = splitInstructionSources(sources);
  const constraints = buildProjectInstructionConstraints(modules);
  const classifications = {
    modules: Object.fromEntries(modules.map((module) => [module.id, "routed"])),
    constraints: Object.fromEntries(constraints.map((constraint) => [constraint.id, "routed"])),
  };
  const triggers = Object.fromEntries(modules.map((module) => [module.id, "code changes"]));
  const result = materializeProjectInstructionCompilerResult(classifications, triggers, constraints);
  const seed = createCertifiedSeedRecord({
    sourceSha256: sha256(content),
    modelsSha256: "b".repeat(64),
    runtimeSha256: "c".repeat(64),
    compilerVersion,
    compilerIdentity,
    compilerModel: { provider: "provider", id: "model", api: "custom-api" },
    result,
    usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, total: 12 },
    elapsedMs: 100,
  });
  writeFileSync(seedPath, `${JSON.stringify(seed)}\n`, { mode: 0o600 });
  const certificate = createSeedCertificate(seed, sha256(readFileSync(seedPath)));
  writeFileSync(certificatePath, `${JSON.stringify(certificate)}\n`, { mode: 0o600 });
  return { sourcePath, workspace, seedPath, certificatePath, receiptPath, certificate, sourceSha256: sha256(content) };
}

function materialize(fixture) {
  return spawnSync(
    process.execPath,
    [
      helper.pathname,
      "materialize",
      "--source",
      fixture.sourcePath,
      "--workspace",
      fixture.workspace,
      "--seed",
      fixture.seedPath,
      "--certificate",
      fixture.certificatePath,
      "--receipt",
      fixture.receiptPath,
    ],
    { encoding: "utf8" },
  );
}

test("materializer creates a path-correct provider-free cache bound to the certified seed", () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-seed-materialize-"));
  try {
    const fixture = createFixture(root);
    const execution = materialize(fixture);
    assert.equal(execution.status, 0, execution.stdout);
    const receipt = JSON.parse(readFileSync(fixture.receiptPath, "utf8"));
    const cache = captureVerifiedCompiledCache(fixture.workspace, fixture.sourceSha256).evidence;
    assert.equal(cache.manifest.compilerUsage, undefined);
    assert.equal(receipt.providerCompilerInvocations, 0);
    assert.equal(receipt.seedMaterializations, 1);
    assertSeededManifestEvidence(
      { ...cache.manifest, cacheClosureSha256: cache.cacheClosureSha256, authorizedPromptHashes: cache.authorizedPromptHashes },
      receipt,
      fixture.certificate,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("materializer rejects stale compiler, model-contract identity, and source without publishing cache", () => {
  for (const kind of ["compiler", "identity", "source"]) {
    const root = mkdtempSync(join(tmpdir(), "p-benchmark-seed-reject-"));
    try {
      const fixture = createFixture(
        root,
        kind === "compiler"
          ? "project-instructions-v4-exact-source-v9-global-provider-context"
          : PROJECT_INSTRUCTION_COMPILER_VERSION,
        kind === "identity" ? "provider/model:exact-source-v7-global-boundaries" : undefined,
      );
      if (kind === "source") writeFileSync(fixture.sourcePath, `${readFileSync(fixture.sourcePath, "utf8")}changed\n`);
      const execution = materialize(fixture);
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
    const fixture = createFixture(root);
    const seedSha256 = sha256(readFileSync(fixture.seedPath));
    const receipts = await Promise.all(Array.from({ length: 3 }, (_, index) =>
      materializeBenchmarkProjectInstructions({
        runtimeSnapshot: new URL("..", import.meta.url).pathname,
        sourceFile: fixture.sourcePath,
        scratchOutput: join(root, `cell-${index}`),
        task: "task",
        seed: {
          seedPath: fixture.seedPath,
          certificatePath: fixture.certificatePath,
          certificate: fixture.certificate,
        },
      }),
    ));
    assert.equal(new Set(receipts.map(({ receipt }) => receipt.certificationHash)).size, 1);
    assert.deepEqual(receipts.map(({ receipt }) => receipt.providerCompilerInvocations), [0, 0, 0]);
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

test("cold certification surfaces only an allowlisted startup diagnostic", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-seed-diagnostic-"));
  try {
    const runtimeSnapshot = join(root, "runtime");
    const scratchRoot = join(root, "scratch");
    const privateRoot = join(root, "private");
    mkdirSync(join(runtimeSnapshot, "scripts"), { recursive: true });
    mkdirSync(scratchRoot);
    mkdirSync(privateRoot);
    const modelsPath = join(privateRoot, "models.json");
    const authPath = join(privateRoot, "auth.json");
    const sourceFile = join(root, "AGENTS.md");
    writeFileSync(modelsPath, "{}\n");
    writeFileSync(authPath, "{}\n");
    writeFileSync(sourceFile, "# Rules\nAlways preserve evidence.\n");
    writeFileSync(
      join(runtimeSnapshot, "scripts", "benchmark-project-instruction-seed.js"),
      'process.stderr.write("private compiler detail"); process.stdout.write(\'{"status":"failed","diagnostic":"project instruction compiler output validation failed","compilerFailure":{"attemptCount":2,"failureKinds":["envelope","constraint-set"],"usage":{"input":10,"output":2,"cacheRead":0,"cacheWrite":0,"total":12},"elapsedMs":123}}\\n\'); process.exit(86);\n',
    );
    await assert.rejects(
      certifyBenchmarkProjectInstructions({
          scratchRoot,
          runtimeSnapshot,
          runtimeSha256: "c".repeat(64),
          sourceFile,
          sourceSha256: sha256(readFileSync(sourceFile)),
          privateSnapshots: { models: { path: modelsPath, sha256: sha256(readFileSync(modelsPath)) }, auth: { path: authPath } },
          compilerModel: "provider/model",
          authOutputGuard: { capture() {} },
        }),
      (error) => {
        assert.equal(error.message, "project instruction compiler output validation failed");
        const telemetry = getBenchmarkCompilerFailureTelemetry(error);
        assert.deepEqual(telemetry, {
          attemptCount: 2,
          failureKinds: ["envelope", "constraint-set"],
          usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, total: 12 },
          elapsedMs: 123,
        });
        const failure = createBenchmarkGateFailure(
          { run: 0, task: "compiler-certification" }, "compiled", error, { compilerCertification: true },
        );
        assert.equal(failure.reason, error.message);
        assert.deepEqual(failure.compilerFailure, telemetry);
        assert.equal(JSON.stringify(error).includes("private compiler detail"), false);
        return true;
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cold certification rejects spoofed or overbroad failure telemetry", async () => {
  const variants = [
    { status: "success", diagnostic: "project instruction compiler output validation failed" },
    { status: "failed", diagnostic: "project instruction compiler output validation failed" },
    { status: "failed", diagnostic: "project instruction compiler output validation failed", raw: "private detail" },
    {
      status: "failed",
      diagnostic: "project instruction compiler output validation failed",
      compilerFailure: {
        attemptCount: 1,
        failureKinds: ["envelope"],
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 },
        elapsedMs: 1,
        raw: "private detail",
      },
    },
    {
      status: "failed",
      diagnostic: "project instruction compiler provider call failed",
      compilerFailure: {
        attemptCount: 1,
        failureKinds: ["envelope"],
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 },
        elapsedMs: 1,
      },
    },
    {
      status: "failed",
      diagnostic: "project instruction compiler output validation failed",
      compilerFailure: {
        attemptCount: 1,
        failureKinds: ["envelope"],
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2, secret: "private detail" },
        elapsedMs: 1,
      },
    },
  ];
  for (const payload of variants) {
    const root = mkdtempSync(join(tmpdir(), "p-benchmark-seed-spoof-"));
    try {
      const runtimeSnapshot = join(root, "runtime");
      const scratchRoot = join(root, "scratch");
      const privateRoot = join(root, "private");
      mkdirSync(join(runtimeSnapshot, "scripts"), { recursive: true });
      mkdirSync(scratchRoot);
      mkdirSync(privateRoot);
      const modelsPath = join(privateRoot, "models.json");
      const authPath = join(privateRoot, "auth.json");
      const sourceFile = join(root, "AGENTS.md");
      writeFileSync(modelsPath, "{}\n");
      writeFileSync(authPath, "{}\n");
      writeFileSync(sourceFile, "# Rules\nAlways preserve evidence.\n");
      writeFileSync(
        join(runtimeSnapshot, "scripts", "benchmark-project-instruction-seed.js"),
        `process.stdout.write(${JSON.stringify(`${JSON.stringify(payload)}\n`)}); process.exit(86);\n`,
      );
      await assert.rejects(
        certifyBenchmarkProjectInstructions({
          scratchRoot,
          runtimeSnapshot,
          runtimeSha256: "c".repeat(64),
          sourceFile,
          sourceSha256: sha256(readFileSync(sourceFile)),
          privateSnapshots: { models: { path: modelsPath, sha256: sha256(readFileSync(modelsPath)) }, auth: { path: authPath } },
          compilerModel: "provider/model",
          authOutputGuard: { capture() {} },
        }),
        (error) =>
          error.message === "project instruction seed helper exited 86" &&
          getBenchmarkCompilerFailureTelemetry(error) === undefined,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
