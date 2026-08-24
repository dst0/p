import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createBenchmarkGateFailure } from "../../src/project-instructions/run-core.ts";
import { renderPairedReport } from "../../src/project-instructions/run-report.ts";
import {
  certifyBenchmarkProjectInstructions,
  getBenchmarkCompilerFailureTelemetry,
} from "../../src/project-instructions/seed-runner.ts";

const SAFE_TELEMETRY = {
  attemptCount: 2,
  failureKinds: ["envelope", "grounding-semantic"],
  usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, total: 12 },
  elapsedMs: 123,
};

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function certificationError(payload: unknown, stderr = ""): Promise<unknown> {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-compiler-failure-"));
  try {
    const runtimeSnapshot = join(root, "runtime");
    const scratchRoot = join(root, "scratch");
    const privateRoot = join(root, "private");
    mkdirSync(join(runtimeSnapshot, "benchmarks", "src", "project-instructions"), { recursive: true });
    mkdirSync(scratchRoot);
    mkdirSync(privateRoot);
    const modelsPath = join(privateRoot, "models.json");
    const authPath = join(privateRoot, "auth.json");
    const sourceFile = join(root, "AGENTS.md");
    writeFileSync(modelsPath, "{}\n");
    writeFileSync(authPath, "{}\n");
    writeFileSync(sourceFile, "# Rules\nAlways preserve evidence.\n");
    writeFileSync(
      join(runtimeSnapshot, "benchmarks", "src", "project-instructions", "seed.ts"),
      `process.stderr.write(${JSON.stringify(stderr)}); process.stdout.write(${JSON.stringify(
        `${JSON.stringify(payload)}\n`,
      )}); process.exit(86);\n`,
    );
    try {
      await certifyBenchmarkProjectInstructions({
        scratchRoot,
        runtimeSnapshot,
        runtimeSha256: "c".repeat(64),
        sourceFile,
        sourceSha256: sha256(readFileSync(sourceFile)),
        privateSnapshots: {
          models: { path: modelsPath, sha256: sha256(readFileSync(modelsPath)) },
          auth: { path: authPath },
        },
        compilerModel: "provider/model",
        authOutputGuard: { capture() {} },
      });
    } catch (error) {
      return error;
    }
    throw new Error("Expected cold certification to fail");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function failedDocument(
  failure: ReturnType<typeof createBenchmarkGateFailure>,
): Parameters<typeof renderPairedReport>[0] {
  return {
    generatedAt: "2026-08-23T00:00:00.000Z",
    model: "provider/task-model",
    compilerModel: "provider/compiler-model",
    binarySha256: "a".repeat(64),
    candidateVersion: "5.0.1-rc.4",
    seed: "seed",
    runs: 3,
    tasks: ["typescript-calculator"],
    schedule: [{ run: 1, task: "typescript-calculator", modes: ["compiled", "legacy"] }],
    samples: [],
    completed: false,
    gate: { passed: false, failure },
  };
}

test("branded normalized compiler telemetry survives the gate and report without private output", async () => {
  const error = await certificationError(
    {
      status: "failed",
      diagnostic: "project instruction compiler output validation failed",
      compilerFailure: SAFE_TELEMETRY,
    },
    "private compiler stderr sk-private-auth-token",
  );
  const first = getBenchmarkCompilerFailureTelemetry(error);
  assert.deepEqual(first, SAFE_TELEMETRY);
  first.failureKinds[0] = "provider";
  assert.deepEqual(getBenchmarkCompilerFailureTelemetry(error), SAFE_TELEMETRY);

  const failure = createBenchmarkGateFailure({ run: 0, task: "compiler-certification" }, "compiled", error);
  assert.deepEqual(failure, {
    run: 0,
    task: "compiler-certification",
    mode: "compiled",
    reason: "project instruction compiler output validation failed",
    compilerFailure: SAFE_TELEMETRY,
  });
  const report = renderPairedReport(failedDocument(failure));
  assert.match(report, /Compiler telemetry: 2 attempts; envelope, grounding-semantic; 12 tokens; 123 ms\./u);
  assert.doesNotMatch(report, /private compiler stderr|sk-private-auth-token/u);
});

test("unbranded, spoofed, and unsafe compiler telemetry never reaches evidence or reports", async () => {
  const spoofed = Object.assign(new Error("project instruction compiler output validation failed"), {
    compilerFailure: SAFE_TELEMETRY,
  });
  assert.equal(getBenchmarkCompilerFailureTelemetry(spoofed), undefined);
  const spoofedFailure = createBenchmarkGateFailure({ run: 0, task: "compiler-certification" }, "compiled", spoofed);
  assert.equal(Object.hasOwn(spoofedFailure, "compilerFailure"), false);

  const unknownKindError = await certificationError({
    status: "failed",
    diagnostic: "project instruction compiler output validation failed",
    compilerFailure: {
      ...SAFE_TELEMETRY,
      failureKinds: ["envelope", "Authorization: private-auth-shaped-kind"],
    },
  });
  assert.equal(getBenchmarkCompilerFailureTelemetry(unknownKindError), undefined);
  const unknownKindFailure = createBenchmarkGateFailure(
    { run: 0, task: "compiler-certification" },
    "compiled",
    unknownKindError,
    { compilerCertification: true },
  );
  assert.equal(Object.hasOwn(unknownKindFailure, "compilerFailure"), false);
  assert.doesNotMatch(JSON.stringify(unknownKindFailure), /Authorization|private-auth-shaped-kind/u);
  assert.doesNotMatch(
    renderPairedReport(failedDocument(unknownKindFailure)),
    /Authorization|private-auth-shaped-kind/u,
  );

  const unsafeError = await certificationError({
    status: "failed",
    diagnostic: "project instruction compiler output validation failed",
    compilerFailure: { ...SAFE_TELEMETRY, raw: "private payload" },
  });
  assert.equal(getBenchmarkCompilerFailureTelemetry(unsafeError), undefined);
  const unsafeFailure = createBenchmarkGateFailure({ run: 0, task: "compiler-certification" }, "compiled", unsafeError);
  assert.equal(Object.hasOwn(unsafeFailure, "compilerFailure"), false);
  assert.doesNotMatch(JSON.stringify(unsafeFailure), /private payload/u);
  assert.doesNotMatch(renderPairedReport(failedDocument(unsafeFailure)), /private payload/u);
});

for (const diagnostic of [
  "project instruction compiler model does not support thinking off",
  "project instruction compiler model lacks explicit thinking-disable compatibility",
]) {
  test(`cold certification preserves the production diagnostic: ${diagnostic}`, async () => {
    const error = await certificationError({ status: "failed", diagnostic });
    assert.ok(error instanceof Error);
    assert.equal(error.message, diagnostic);
    assert.equal(getBenchmarkCompilerFailureTelemetry(error), undefined);
  });
}
