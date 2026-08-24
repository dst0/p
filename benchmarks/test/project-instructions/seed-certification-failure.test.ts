import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createBenchmarkGateFailure } from "../../src/project-instructions/failure.ts";
import {
  certifyBenchmarkProjectInstructions,
  getBenchmarkCompilerFailureTelemetry,
} from "../../src/project-instructions/seed-runner.ts";

const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

function createColdCertificationFixture(root: string, helperSource: string) {
  const runtimeSnapshot = join(root, "runtime");
  const scratchRoot = join(root, "scratch");
  const privateRoot = join(root, "private");
  const seedHelperDirectory = join(runtimeSnapshot, "benchmarks", "src", "project-instructions");
  mkdirSync(seedHelperDirectory, { recursive: true });
  mkdirSync(scratchRoot);
  mkdirSync(privateRoot);
  const modelsPath = join(privateRoot, "models.json");
  const authPath = join(privateRoot, "auth.json");
  const sourceFile = join(root, "AGENTS.md");
  writeFileSync(modelsPath, "{}\n");
  writeFileSync(authPath, "{}\n");
  writeFileSync(sourceFile, "# Rules\nAlways preserve evidence.\n");
  writeFileSync(join(seedHelperDirectory, "seed.ts"), helperSource);
  return {
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
  };
}

test("cold certification surfaces only an allowlisted startup diagnostic", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-seed-diagnostic-"));
  try {
    const options = createColdCertificationFixture(
      root,
      'process.stderr.write("private compiler detail"); process.stdout.write(\'{"status":"failed","diagnostic":"project instruction compiler output validation failed","compilerFailure":{"attemptCount":2,"failureKinds":["envelope","constraint-set"],"usage":{"input":10,"output":2,"cacheRead":0,"cacheWrite":0,"total":12},"elapsedMs":123}}\\n\'); process.exit(86);\n',
    );
    await assert.rejects(certifyBenchmarkProjectInstructions(options), (error) => {
      if (!(error instanceof Error)) return false;
      assert.equal(error.message, "project instruction compiler output validation failed");
      const telemetry = getBenchmarkCompilerFailureTelemetry(error);
      assert.deepEqual(telemetry, {
        attemptCount: 2,
        failureKinds: ["envelope", "constraint-set"],
        usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, total: 12 },
        elapsedMs: 123,
      });
      const failure = createBenchmarkGateFailure({ run: 0, task: "compiler-certification" }, "compiled", error, {
        compilerCertification: true,
      });
      assert.equal(failure.reason, error.message);
      assert.deepEqual(failure.compilerFailure, telemetry);
      assert.equal(JSON.stringify(error).includes("private compiler detail"), false);
      return true;
    });
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
      const options = createColdCertificationFixture(
        root,
        `process.stdout.write(${JSON.stringify(`${JSON.stringify(payload)}\n`)}); process.exit(86);\n`,
      );
      await assert.rejects(
        certifyBenchmarkProjectInstructions(options),
        (error) =>
          error instanceof Error &&
          error.message === "project instruction seed helper exited 86" &&
          getBenchmarkCompilerFailureTelemetry(error) === undefined,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
