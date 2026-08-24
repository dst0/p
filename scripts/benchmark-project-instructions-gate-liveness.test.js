import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attachPairedBenchmarkLiveness,
  createClassifiedBenchmarkGateFailure,
} from "./benchmark-project-instructions-failure.js";
import { createUnavailableCellLiveness } from "./benchmark-project-instructions-liveness.js";

const pair = { run: 2, task: "event-sourced-inventory" };
const expectedLivenessKeys = [
  "firstMutationElapsedMs",
  "heartbeatCount",
  "heartbeatIntervalMs",
  "mutationCount",
  "observedRequirementDefinitionAttemptCount",
  "progressEvidence",
  "requirementDefinitionAttemptCount",
  "semanticEvidenceAvailable",
  "semanticEvidenceComplete",
  "semanticSequence",
];

test("every pre-cell and assessed gate failure carries the uniform unavailable liveness schema", () => {
  const cases = [
    ["overall deadline reached", "infrastructure"],
    ["immutable P runtime changed before the benchmark cell", "infrastructure"],
    ["ephemeral private benchmark inputs changed before the benchmark cell", "infrastructure"],
    ["project-instruction preseed receipt mismatch", "infrastructure"],
    ["paired run ended early", "infrastructure"],
    ["capture overflow: raw recording exceeded 64 bytes", "infrastructure"],
    ["run status timed_out", "status"],
    ["quality gate failed (95/100)", "correctness"],
  ];
  for (const [reason, kind] of cases) {
    const failure = createClassifiedBenchmarkGateFailure(pair, "compiled", reason);
    assert.equal(failure.kind, kind, reason);
    assert.deepEqual(Object.keys(failure.liveness).toSorted(), expectedLivenessKeys, reason);
    assert.deepEqual(failure.liveness, createUnavailableCellLiveness(), reason);
    const persisted = JSON.parse(JSON.stringify(failure));
    assert.deepEqual(Object.keys(persisted.liveness).toSorted(), expectedLivenessKeys, reason);
    assert.equal(persisted.liveness.requirementDefinitionAttemptCount, null, reason);
    assert.equal(persisted.liveness.observedRequirementDefinitionAttemptCount, 0, reason);
  }
});

test("process gate failures preserve collected liveness instead of replacing it", () => {
  const liveness = {
    ...createUnavailableCellLiveness(),
    heartbeatCount: 2,
    semanticEvidenceAvailable: true,
    semanticEvidenceComplete: false,
    semanticSequence: 5,
    mutationCount: 2,
    progressEvidence: "progress/run-2-event-sourced-inventory-compiled.jsonl.br",
  };
  const error = attachPairedBenchmarkLiveness(new Error("child benchmark exited 9"), liveness);
  const failure = createClassifiedBenchmarkGateFailure(pair, "compiled", error);
  assert.equal(failure.kind, "process");
  assert.deepEqual(failure.liveness, liveness);
});
