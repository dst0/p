import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { test } from "node:test";
import { brotliDecompressSync } from "node:zlib";
import { bindCertifiedOutputRoot } from "../../src/harness/certified-output-integrity.ts";
import { publishBenchmarkEvidence } from "../../src/workloads/benchmark-evidence-publication.ts";
import { finalizeAgentBenchmarkRun } from "../../src/workloads/benchmark-run-finalization.ts";
import { setupCertifiedBenchmark } from "../../src/workloads/certification.ts";
import { createCertifiedTaskVariants } from "../../src/workloads/certification-holdout.ts";
import { sanitizeCertifiedReceiptArtifacts } from "../../src/workloads/certification-receipt-cleanup.ts";
import { parseRunnerArgs } from "../../src/workloads/runner-options.ts";
import { benchmarkTasks } from "../../src/workloads/task-registry.ts";
import { createSyntheticCertifiedMatrix } from "./certification-matrix-fixture.ts";
import { writeCertifiedModelConfigurationFixture } from "./certification-model-config-fixture.ts";

test(
  "successful certified pipeline reaches default release receipt persistence",
  { skip: process.platform !== "darwin" },
  () => {
    const fixture = createPipelineFixture();
    try {
      const publication = publishFixtureEvidence(fixture);
      assert.ok(publication.validateReleaseEvidence);
      assert.ok(publication.publishReleaseEvidence);

      finalizeAgentBenchmarkRun({
        mutableArtifactsSafe: true,
        finalizeAgentResources: () => {},
        validateReleaseEvidence: publication.validateReleaseEvidence,
        sanitizeReceipt: () => sanitizeCertifiedReceiptArtifacts(fixture.output, fixture.receiptValue),
        disposeFreeze: fixture.disposeFreeze,
        publishReleaseEvidence: publication.publishReleaseEvidence,
      });

      const receipt = readPersistedReceipt(fixture.repo);
      assert.equal(receipt.targetVersion, "5.0.1");
      assert.equal(receipt.binding.holdoutSha256, fixture.holdoutSha256);
      assert.equal(existsSync(fixture.privateEvaluatorPath), false);
      assert.equal(existsSync(fixture.privateCandidatePath), false);
      assert.equal(existsSync(join(fixture.output, "instructions")), false);

      const publicResult = readFileSync(publication.resultPath, "utf8");
      assert.equal(publicResult.includes(fixture.privateEvaluatorPath), false);
      assert.equal(publicResult.includes(fixture.privateCandidatePath), false);
    } finally {
      fixture.dispose();
    }
  },
);

test(
  "certified pipeline suppresses default persistence after cleanup failure",
  { skip: process.platform !== "darwin" },
  () => {
    const fixture = createPipelineFixture();
    try {
      const publication = publishFixtureEvidence(fixture);
      assert.throws(
        () =>
          finalizeAgentBenchmarkRun({
            mutableArtifactsSafe: true,
            finalizeAgentResources: () => {},
            validateReleaseEvidence: publication.validateReleaseEvidence,
            sanitizeReceipt: () => {
              throw new Error("receipt cleanup failed");
            },
            disposeFreeze: fixture.disposeFreeze,
            publishReleaseEvidence: publication.publishReleaseEvidence,
          }),
        /cleanup errors/u,
      );
      assert.equal(existsSync(receiptPath(fixture.repo)), false);
      assert.equal(existsSync(fixture.privateEvaluatorPath), false);
      assert.equal(existsSync(fixture.privateCandidatePath), false);
    } finally {
      fixture.dispose();
    }
  },
);

interface PipelineFixture {
  repo: string;
  output: string;
  options: ReturnType<typeof parseRunnerArgs>;
  versions: Record<string, string>;
  binding: NonNullable<ReturnType<typeof setupCertifiedBenchmark>["binding"]>;
  tasks: ReturnType<typeof createCertifiedTaskVariants>;
  receiptValue: string;
  holdoutSha256: string;
  privateCandidatePath: string;
  privateEvaluatorPath: string;
  disposeFreeze(): void;
  dispose(): void;
}

function createPipelineFixture(): PipelineFixture {
  const root = mkdtempSync(join(tmpdir(), "certified-release-pipeline-"));
  try {
    const repo = join(root, "repo");
    const output = join(root, "output");
    createMinimalRepository(repo);
    initializeRemote(root, repo);
    mkdirSync(output);
    bindCertifiedOutputRoot(output);
    const pi = createVersionExecutable(join(root, "pi-package"), "pi", "1.0.0");
    const kilo = createVersionExecutable(join(root, "kilo-package"), "kilo", "2.0.0");
    const modelConfiguration = writeCertifiedModelConfigurationFixture(root);
    const options = parseRunnerArgs([
      "--certified",
      "--model",
      "backend/model",
      "--expected-resolved-model",
      "backend/model",
      "--runs",
      "3",
      "--release-target",
      "5.0.1",
      "--pi-executable",
      pi,
      "--pi-version",
      "1.0.0",
      "--kilo-executable",
      kilo,
      "--kilo-version",
      "2.0.0",
      "--models-file",
      modelConfiguration.modelsFile,
      "--kilo-config",
      modelConfiguration.kiloConfig,
      "--project-instructions-file",
      join(repo, "AGENTS.md"),
    ]);
    const versions = { p: "0.4.0", pi: "1.0.0", kilo: "2.0.0" };
    const setup = setupCertifiedBenchmark(options, versions, repo, output);
    assert.ok(setup.binding && setup.freeze && setup.holdout && setup.receiptValue);
    const receiptSha256 = setup.binding.projectInstructions.receiptSha256!;
    setup.binding.receipts = (["p", "pi", "kilo"] as const).map((agent) => ({
      agent,
      status: "passed",
      receiptSha256,
      responseMatched: true,
      responseModel: "backend/model",
      responseModels: ["backend/model"],
      elapsedMs: 10,
    }));
    const disposeFreeze = setup.freeze.dispose;
    return {
      repo,
      output,
      options,
      versions,
      binding: setup.binding,
      tasks: createCertifiedTaskVariants(benchmarkTasks, setup.holdout),
      receiptValue: setup.receiptValue,
      holdoutSha256: setup.holdout.holdoutSha256,
      privateCandidatePath: setup.freeze.candidateRuntimePath,
      privateEvaluatorPath: setup.freeze.evaluator.path,
      disposeFreeze,
      dispose: () => {
        disposeFreeze();
        rmSync(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function publishFixtureEvidence(fixture: PipelineFixture) {
  const rows = createSyntheticCertifiedMatrix({ responseModel: "backend/model" }).map((row) => {
    if (row.status !== "passed") throw new Error("Synthetic certified fixture unexpectedly did not pass");
    return {
      ...row,
      status: "passed" as const,
      elapsedMs: row.elapsedMs!,
      metrics: row.metrics!,
      quality: { ...row.quality!, checks: [] },
    };
  });
  return publishBenchmarkEvidence({
    options: fixture.options,
    versions: fixture.versions,
    results: rows,
    output: fixture.output,
    repoRoot: fixture.repo,
    tasks: fixture.tasks,
    startupProbes: {},
    evaluationFreeze: {
      candidateRuntimePath: fixture.privateCandidatePath,
      candidateRuntimeSha256: fixture.binding.pSnapshot.sha256,
      evaluator: {
        path: fixture.privateEvaluatorPath,
        sha256: fixture.binding.evaluator.sha256,
        dispose: () => {},
      },
      dispose: fixture.disposeFreeze,
    },
    harnessBinding: fixture.binding,
  });
}

function createVersionExecutable(root: string, name: string, version: string): string {
  const path = join(root, "bin", name);
  mkdirSync(join(root, "bin"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name, version }));
  writeFileSync(path, `#!/bin/sh\necho '${version}'\n`);
  chmodSync(path, 0o755);
  return path;
}

function createMinimalRepository(repo: string): void {
  mkdirSync(join(repo, "node_modules"), { recursive: true });
  mkdirSync(join(repo, "benchmarks", "src", "project-instructions"), { recursive: true });
  mkdirSync(join(repo, "benchmarks", "src", "harness"), { recursive: true });
  mkdirSync(join(repo, "benchmarks", "fixtures", "fixture"), { recursive: true });
  for (const pkg of ["ai", "tui", "agent", "code-index", "coding-agent", "site"]) {
    mkdirSync(join(repo, "packages", pkg, "dist"), { recursive: true });
    writeFileSync(join(repo, "packages", pkg, "package.json"), JSON.stringify({ version: "0.4.0" }));
  }
  writeFileSync(join(repo, "packages", "coding-agent", "dist", "cli.js"), "process.exit(0);\n");
  writeFileSync(join(repo, "package.json"), JSON.stringify({ version: "0.4.0" }));
  writeFileSync(join(repo, "package-lock.json"), "{}\n");
  writeFileSync(join(repo, "AGENTS.md"), "# Rules\n");
  for (const file of [
    "run-agents.ts",
    "run-project-instructions.ts",
    "project-instructions/probe.ts",
    "project-instructions/seed.ts",
    "harness/seed-helper-process.ts",
  ]) {
    writeFileSync(join(repo, "benchmarks", "src", file), "export {};\n");
  }
  writeFileSync(join(repo, "benchmarks", "fixtures", "fixture", "visible.ts"), "export {};\n");
  writeFileSync(join(repo, "benchmarks", "fixtures", "fixture", "hidden.test.ts"), "// hidden\n");
  writeFileSync(join(repo, "benchmarks", "fixtures", "fixture", "rubric.json"), "[]\n");
}

function initializeRemote(root: string, repo: string): void {
  const remote = join(root, "origin.git");
  git(root, "init", "--bare", "-b", "main", remote);
  git(repo, "init", "-b", "main");
  for (const target of [remote, repo]) disableMaintenance(target);
  git(repo, "config", "user.email", "benchmark-test@example.invalid");
  git(repo, "config", "user.name", "Benchmark Test");
  git(repo, "remote", "add", "origin", remote);
  git(repo, "add", "--all");
  git(repo, "commit", "-m", "fixture");
  git(repo, "push", "-u", "origin", "main");
}

function disableMaintenance(repo: string): void {
  for (const [key, value] of [
    ["maintenance.auto", "false"],
    ["maintenance.autoDetach", "false"],
    ["gc.auto", "0"],
    ["gc.autoDetach", "false"],
  ])
    git(repo, "config", "--local", key, value);
}

function receiptPath(repo: string): string {
  const gitDirectory = git(repo, "rev-parse", "--git-common-dir");
  return resolve(
    isAbsolute(gitDirectory) ? gitDirectory : join(repo, gitDirectory),
    "p-release-benchmark-certification.json.br",
  );
}

interface PersistedReceipt {
  targetVersion: string;
  binding: { holdoutSha256: string };
}

function readPersistedReceipt(repo: string): PersistedReceipt {
  const parsed: unknown = JSON.parse(brotliDecompressSync(readFileSync(receiptPath(repo))).toString("utf8"));
  if (
    !isRecord(parsed) ||
    typeof parsed.targetVersion !== "string" ||
    !isRecord(parsed.binding) ||
    typeof parsed.binding.holdoutSha256 !== "string"
  ) {
    throw new Error("Persisted benchmark receipt has an unexpected shape");
  }
  return {
    targetVersion: parsed.targetVersion,
    binding: { holdoutSha256: parsed.binding.holdoutSha256 },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}
