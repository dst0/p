import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { evaluateCertification } from "../../src/workloads/certification.ts";
import { publishReleaseBenchmarkCertification } from "../../src/workloads/release-benchmark-publication.ts";
import { parseRunnerArgs } from "../../src/workloads/runner-options.ts";
import { benchmarkTasks } from "../../src/workloads/task-registry.ts";
import { createSyntheticCertifiedMatrix } from "./certification-matrix-fixture.ts";

const directories: string[] = [];
const bindingHashes = {
  candidateRuntimeSha256: "1".repeat(64),
  evaluatorSha256: "2".repeat(64),
  holdoutSha256: "3".repeat(64),
  kiloExecutableSha256: "4".repeat(64),
  modelConfigurationSha256: "5".repeat(64),
  nodeExecutableSha256: "6".repeat(64),
  piExecutableSha256: "7".repeat(64),
  projectInstructionsSha256: "8".repeat(64),
};
const harnessBinding = {
  node: { path: "/node", version: "v22.0.0", sha256: bindingHashes.nodeExecutableSha256 },
  pSnapshot: { path: "/p", version: "5.0.1", sha256: bindingHashes.candidateRuntimeSha256 },
  pi: { path: "/pi", version: "0.82.1", sha256: bindingHashes.piExecutableSha256 },
  kilo: { path: "/kilo", version: "7.4.17", sha256: bindingHashes.kiloExecutableSha256 },
  modelConfiguration: { sha256: bindingHashes.modelConfigurationSha256 },
  projectInstructions: {
    path: "/AGENTS.md",
    sha256: bindingHashes.projectInstructionsSha256,
    receiptSha256: "9".repeat(64),
  },
  evaluator: { path: "/evaluator", sha256: bindingHashes.evaluatorSha256 },
  holdoutSha256: bindingHashes.holdoutSha256,
  receipts: (["p", "pi", "kilo"] as const).map((agent) => ({
    agent,
    status: "passed" as const,
    receiptSha256: "9".repeat(64),
    responseMatched: true,
    responseModel: "resolved/model",
    responseModels: ["resolved/model"],
    elapsedMs: 10,
  })),
};

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "release-benchmark-publication-"));
  directories.push(directory);
  const resultPath = join(directory, "results.json");
  const reportPath = join(directory, "report.md");
  const options = parseRunnerArgs([
    "--certified",
    "--model",
    "provider/model",
    "--expected-resolved-model",
    "resolved/model",
    "--runs",
    "3",
    "--release-target",
    "5.0.1",
  ]);
  const results = createSyntheticCertifiedMatrix({ responseModel: "resolved/model" });
  const certification = evaluateCertification(results, options, harnessBinding);
  writeFileSync(
    resultPath,
    `${JSON.stringify({
      agents: options.agents,
      runs: options.runs,
      tasks: benchmarkTasks.map(({ id }) => ({ id })),
      certification,
      results,
    })}\n`,
  );
  writeFileSync(reportPath, "## Certification Results\n\n**Result: PASSED**\n");
  return { certification, options, reportPath, resultPath, results };
}

test("publishes hashes and exact certified matrix evidence", () => {
  const current = fixture();
  let persisted: unknown;
  const receipt = publishReleaseBenchmarkCertification({
    repoRoot: "/repo",
    ...current,
    now: () => new Date("2026-09-21T01:02:03.000Z"),
    persist: (_repoRoot, evidence) => {
      persisted = evidence;
      return { id: "receipt" };
    },
  });
  assert.deepEqual(receipt, { id: "receipt" });
  assert.deepEqual(persisted, {
    targetVersion: "5.0.1",
    resultSha256: createHash("sha256").update(read(current.resultPath)).digest("hex"),
    reportSha256: createHash("sha256").update(read(current.reportPath)).digest("hex"),
    matrix: {
      agents: ["p", "pi", "kilo"],
      tasks: benchmarkTasks.map(({ id }) => id),
      runs: 3,
      cellCount: 36,
      expectedResolvedModel: "resolved/model",
    },
    binding: bindingHashes,
    thresholds: { maxDurationRatio: 1, maxTokenRatio: 1, maxCostRatio: null },
    createdAt: "2026-09-21T01:02:03.000Z",
  });
});

test("fails closed when the stored matrix or passing report is inconsistent", () => {
  const missingCell = fixture();
  writeFileSync(
    missingCell.resultPath,
    `${JSON.stringify({
      agents: missingCell.options.agents,
      runs: 3,
      tasks: benchmarkTasks.map(({ id }) => ({ id })),
      certification: missingCell.certification,
      results: missingCell.results.slice(1),
    })}\n`,
  );
  assert.throws(
    () => publishReleaseBenchmarkCertification({ repoRoot: "/repo", ...missingCell }),
    /Stored benchmark matrix did not pass certification/u,
  );

  const failedReport = fixture();
  writeFileSync(failedReport.reportPath, "## Certification Results\n\n**Result: FAILED**\n");
  assert.throws(
    () => publishReleaseBenchmarkCertification({ repoRoot: "/repo", ...failedReport }),
    /report does not contain a passing certification result/u,
  );
});

test("rejects failed in-memory certification and placeholder binding hashes", () => {
  const failed = fixture();
  assert.throws(
    () =>
      publishReleaseBenchmarkCertification({
        repoRoot: "/repo",
        ...failed,
        certification: { passed: false, failures: ["failure"] },
      }),
    /benchmark certification did not pass/u,
  );
  assert.throws(
    () =>
      publishReleaseBenchmarkCertification({
        repoRoot: "/repo",
        ...failed,
        certification: {
          ...failed.certification,
          binding: { ...failed.certification.binding!, holdoutSha256: "0".repeat(64) } as typeof harnessBinding,
        },
      }),
    /invalid binding holdoutSha256/u,
  );
});

function read(path: string): Buffer {
  return readFileSync(path);
}
