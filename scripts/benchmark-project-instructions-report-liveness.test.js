import assert from "node:assert/strict";
import { test } from "node:test";
import { renderPairedReport } from "./benchmark-project-instructions-core.js";
import { createClassifiedBenchmarkGateFailure } from "./benchmark-project-instructions-failure.js";
import { createUnavailableCellLiveness } from "./benchmark-project-instructions-liveness.js";

const pair = { run: 1, task: "typescript-calculator" };

function failedDocument(failure) {
  return {
    generatedAt: "2026-08-23T00:00:00.000Z",
    model: "provider/model",
    binarySha256: "runtime-hash",
    seed: "seed",
    runs: 3,
    tasks: [pair.task],
    schedule: [{ ...pair, modes: ["compiled", "legacy"] }],
    samples: [],
    completed: false,
    gate: { passed: false, failure },
  };
}

test("failed reports render liveness for every gate-failure class", () => {
  const cases = [
    "overall deadline reached",
    "ephemeral private benchmark inputs changed before the benchmark cell",
    "project-instruction preseed receipt mismatch",
    "child benchmark exited 9",
    "capture overflow: raw recording exceeded 64 bytes",
    "run status timed_out",
    "quality gate failed (95/100)",
  ];
  for (const reason of cases) {
    const failure = createClassifiedBenchmarkGateFailure(pair, "compiled", reason);
    const report = renderPairedReport(failedDocument(failure));
    assert.match(report, /Gate liveness:/u, reason);
    assert.match(report, /Requirement definitions: n\/a/u, reason);
    assert.match(report, /sparse repairs: n\/a/u, reason);
    assert.match(report, /Semantic evidence available: no; complete: no/u, reason);
    assert.match(report, /Progress evidence: n\/a/u, reason);
  }
});

test("failed reports expose collected lower-bound evidence without claiming completeness", () => {
  const liveness = {
    ...createUnavailableCellLiveness(),
    heartbeatCount: 1,
    firstMutationElapsedMs: 1_250,
    semanticSequence: 4,
    mutationCount: 2,
    semanticEvidenceAvailable: true,
    semanticEvidenceComplete: false,
    observedRequirementDefinitionAttemptCount: 2,
    observedRequirementDefinitionRepairAttemptCount: 3,
    progressEvidence: "progress/run-1-typescript-calculator-compiled.jsonl.br",
  };
  const failure = createClassifiedBenchmarkGateFailure(pair, "compiled", "child benchmark exited 9", {
    liveness,
  });
  const report = renderPairedReport(failedDocument(failure));
  assert.match(report, /Requirement definitions: at least 2/u);
  assert.match(report, /sparse repairs: at least 3/u);
  assert.match(report, /Semantic evidence available: yes; complete: no/u);
  assert.match(report, /Progress evidence: `progress\/run-1-typescript-calculator-compiled\.jsonl\.br`/u);
});

test("sample rows distinguish exact and observed lower-bound definition counts", () => {
  const liveness = {
    ...createUnavailableCellLiveness(),
    semanticEvidenceAvailable: true,
    semanticEvidenceComplete: false,
    observedRequirementDefinitionAttemptCount: 3,
  };
  const document = failedDocument(createClassifiedBenchmarkGateFailure(pair, "compiled", "quality gate failed"));
  document.samples.push({
    ...pair,
    mode: "compiled",
    status: "failed",
    elapsedMs: 1,
    metrics: { usage: { totalTokens: 1 } },
    quality: { rawScore: 0, maxScore: 1 },
    liveness,
  });
  assert.match(renderPairedReport(document), /\| at least 3 \|/u);
});
