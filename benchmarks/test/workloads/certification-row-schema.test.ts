import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateCertification } from "../../src/workloads/certification.ts";
import { parseRunnerArgs } from "../../src/workloads/runner-options.ts";
import { createSyntheticCertifiedMatrix } from "./certification-matrix-fixture.ts";

const options = parseRunnerArgs([
  "--certified",
  "--model",
  "surface/model",
  "--expected-resolved-model",
  "resolved/test-model",
  "--runs",
  "3",
]);

test("certification rejects every malformed row and nested runtime field", () => {
  const mutations: Array<[string, (row: Record<string, unknown>) => void]> = [
    [
      "run",
      (row) => {
        row.run = "1";
      },
    ],
    [
      "status",
      (row) => {
        row.status = "complete";
      },
    ],
    [
      "elapsedMs",
      (row) => {
        row.elapsedMs = Number.POSITIVE_INFINITY;
      },
    ],
    [
      "timedOut",
      (row) => {
        row.timedOut = "false";
      },
    ],
    [
      "quality.passed",
      (row) => {
        (row.quality as Record<string, unknown>).passed = "true";
      },
    ],
    [
      "quality.score",
      (row) => {
        (row.quality as Record<string, unknown>).score = Number.NaN;
      },
    ],
    [
      "metrics.toolErrors",
      (row) => {
        (row.metrics as Record<string, unknown>).toolErrors = undefined;
      },
    ],
    [
      "metrics.toolCalls",
      (row) => {
        (row.metrics as Record<string, unknown>).toolCalls = -1;
      },
    ],
    [
      "metrics.errors",
      (row) => {
        (row.metrics as Record<string, unknown>).errors = [1];
      },
    ],
    [
      "metrics.usage.input",
      (row) => {
        ((row.metrics as Record<string, unknown>).usage as Record<string, unknown>).input = Number.NaN;
      },
    ],
    [
      "quality.rawScore",
      (row) => {
        (row.quality as Record<string, unknown>).rawScore = 0;
      },
    ],
    [
      "quality.maxScore",
      (row) => {
        const quality = row.quality as Record<string, unknown>;
        quality.maxScore = 999;
        quality.score = 999;
        quality.rawScore = 999;
      },
    ],
  ];
  for (const [field, mutate] of mutations) {
    const rows = createSyntheticCertifiedMatrix();
    mutate(rows[0] as unknown as Record<string, unknown>);
    const outcome = evaluateCertification(rows, options);
    assert.equal(outcome.passed, false, field);
    assert.match(outcome.failures.join("\n"), new RegExp(field.replace(".", "\\."), "u"), field);
  }
});
