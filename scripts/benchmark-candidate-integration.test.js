import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { runProjectInstructionsBenchmark } from "./benchmark-project-instructions.js";
import { writePairedBenchmarkEvidence } from "./benchmark-project-instructions-output.js";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function environmentWithoutCandidate() {
  const environment = { ...process.env };
  delete environment.P_BENCHMARK_CANDIDATE_VERSION;
  return environment;
}

test("project-instruction benchmark requires candidate identity except for help", () => {
  const help = spawnSync(process.execPath, ["scripts/benchmark-project-instructions.js", "--help"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: environmentWithoutCandidate(),
  });
  assert.equal(help.status, 0, help.stderr);

  const missing = spawnSync(process.execPath, ["scripts/benchmark-project-instructions.js", "--model", "provider/model"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: environmentWithoutCandidate(),
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /candidate version is required/u);

  const mismatched = spawnSync(
    process.execPath,
    ["scripts/benchmark-project-instructions.js", "--model", "provider/model", "--output", "/tmp/no-candidate-here"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, P_BENCHMARK_CANDIDATE_VERSION: "5.0.1-rc.1" },
    },
  );
  assert.equal(mismatched.status, 1);
  assert.match(mismatched.stderr, /exact candidate/u);
});

test("results and report always carry the candidate identity", () => {
  const output = mkdtempSync(join(tmpdir(), "p-candidate-output-"));
  const document = {
    schemaVersion: 1,
    candidateVersion: "5.0.1-rc.7",
    generatedAt: "2026-08-24T00:00:00.000Z",
    model: "provider/model",
    seed: "seed",
    runs: 3,
    tasks: [],
    binarySha256: "a".repeat(64),
    schedule: [],
    samples: [],
    completed: false,
    gate: { passed: true },
  };
  try {
    writePairedBenchmarkEvidence(output, document);
    assert.equal(JSON.parse(readFileSync(join(output, "results.json"), "utf8")).candidateVersion, "5.0.1-rc.7");
    assert.match(readFileSync(join(output, "report.md"), "utf8"), /Candidate version: `5\.0\.1-rc\.7`/u);

    const invalidOutput = join(output, "invalid");
    mkdirSync(invalidOutput);
    assert.throws(
      () => writePairedBenchmarkEvidence(invalidOutput, { ...document, candidateVersion: undefined }),
      /candidate version is required/u,
    );
    assert.equal(existsSync(join(invalidOutput, "results.json")), false);
    assert.equal(existsSync(join(invalidOutput, "report.md")), false);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test("candidate output mismatch fails before clean-checkout build checks", async () => {
  let checkedBuild = false;
  await assert.rejects(
    runProjectInstructionsBenchmark({
      argv: ["--model", "provider/model", "--output", "/tmp/wrong-output"],
      environment: { P_BENCHMARK_CANDIDATE_VERSION: "5.0.1-rc.1" },
      root: "/clean-checkout",
      dependencies: {
        pathExists: () => {
          checkedBuild = true;
          return false;
        },
      },
    }),
    /exact candidate/u,
  );
  assert.equal(checkedBuild, false);
});

test("main binds the real runtime hash before certification and reuses it across reruns", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-candidate-main-"));
  const runtimeSnapshot = join(root, "runtime");
  const privateDirectory = join(root, "private");
  const scratchRoot = join(root, "scratch");
  const authPath = join(privateDirectory, "auth.json");
  const modelsPath = join(privateDirectory, "models.json");
  mkdirSync(join(root, "packages", "coding-agent", "dist"), { recursive: true });
  mkdirSync(runtimeSnapshot);
  mkdirSync(privateDirectory);
  writeFileSync(join(root, "AGENTS.md"), "candidate integration\n", "utf8");
  writeFileSync(join(root, "packages", "coding-agent", "dist", "cli.js"), "runtime\n", "utf8");
  writeFileSync(join(runtimeSnapshot, "runtime.js"), "first runtime\n", "utf8");
  writeFileSync(authPath, "{}\n", "utf8");
  writeFileSync(modelsPath, "{}\n", "utf8");
  const certificationCandidates = [];
  const dependencies = {
    createResources: () => ({
      runtimeSnapshot,
      scratchRoot,
      privateSnapshots: { auth: { path: authPath }, models: { path: modelsPath } },
    }),
    createAuthOutputGuard: () => undefined,
    privateInputEvidence: () => ({}),
    certify: () => {
      const registry = JSON.parse(readFileSync(join(root, ".pdev", "benchmark-candidate-registry.json"), "utf8"));
      certificationCandidates.push(registry.candidates.at(-1).candidateVersion);
      return { certificate: { compilerPreparation: { usage: { total: 0 }, elapsedMs: 0 } } };
    },
    runSchedule: async () => {},
    finalizeResources: () => {},
  };
  const run = (candidateVersion, suffix) =>
    runProjectInstructionsBenchmark({
      argv: ["--model", "provider/model", "--output", join(root, `run-v${candidateVersion}-${suffix}`)],
      environment: { P_BENCHMARK_CANDIDATE_VERSION: candidateVersion },
      root,
      dependencies,
    });
  try {
    await run("5.0.1-rc.1", "first");
    await run("5.0.1-rc.1", "rerun");
    writeFileSync(join(runtimeSnapshot, "runtime.js"), "changed runtime\n", "utf8");
    await run("5.0.1-rc.2", "changed");
    const registry = JSON.parse(readFileSync(join(root, ".pdev", "benchmark-candidate-registry.json"), "utf8"));
    assert.deepEqual(certificationCandidates, ["5.0.1-rc.1", "5.0.1-rc.1", "5.0.1-rc.2"]);
    assert.deepEqual(registry.candidates.map(({ candidateVersion }) => candidateVersion), ["5.0.1-rc.1", "5.0.1-rc.2"]);
    assert.notEqual(registry.candidates[0].runtimeSha256, registry.candidates[1].runtimeSha256);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
