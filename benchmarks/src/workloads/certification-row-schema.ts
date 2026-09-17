import { readMonetaryCost } from "./monetary-cost.ts";

type JsonRecord = Record<string, unknown>;

const statuses = new Set(["passed", "failed", "timed_out", "skipped"]);

export function validateCertifiedBenchmarkRow(value: unknown, index: number, expectedMaxScore?: number): string[] {
  const errors: string[] = [];
  const row = recordAt(value, `row[${index}]`, errors);
  if (!row) return errors;
  integerAt(row.run, `row[${index}].run`, errors, 1);
  stringAt(row.agent, `row[${index}].agent`, errors);
  stringAt(row.task, `row[${index}].task`, errors);
  if (typeof row.status !== "string" || !statuses.has(row.status)) invalid(`row[${index}].status`, errors);
  finiteAt(row.elapsedMs, `row[${index}].elapsedMs`, errors, { positive: true });
  if (row.exitCode !== null) integerAt(row.exitCode, `row[${index}].exitCode`, errors);
  if (typeof row.timedOut !== "boolean") invalid(`row[${index}].timedOut`, errors);
  if (row.error !== undefined && typeof row.error !== "string") invalid(`row[${index}].error`, errors);
  finiteAt(row.nudges, `row[${index}].nudges`, errors, { nonnegative: true });
  validateMetrics(row.metrics, index, errors);
  validateQuality(row.quality, index, errors, expectedMaxScore);
  return errors;
}

function validateMetrics(value: unknown, index: number, errors: string[]): void {
  const prefix = `row[${index}].metrics`;
  const metrics = recordAt(value, prefix, errors);
  if (!metrics) return;
  integerAt(metrics.toolCalls, `${prefix}.toolCalls`, errors, 0);
  integerAt(metrics.toolErrors, `${prefix}.toolErrors`, errors, 0);
  stringAt(metrics.responseModel, `${prefix}.responseModel`, errors);
  if (
    !Array.isArray(metrics.responseModels) ||
    metrics.responseModels.length === 0 ||
    !metrics.responseModels.every((model) => typeof model === "string" && model.trim())
  ) {
    invalid(`${prefix}.responseModels`, errors);
  }
  if (!Array.isArray(metrics.errors) || !metrics.errors.every((error) => typeof error === "string")) {
    invalid(`${prefix}.errors`, errors);
  }
  const usage = recordAt(metrics.usage, `${prefix}.usage`, errors);
  if (!usage) return;
  for (const field of ["input", "output", "cacheRead", "cacheWrite"] as const) {
    finiteAt(usage[field], `${prefix}.usage.${field}`, errors, { nonnegative: true });
  }
  finiteAt(usage.totalTokens, `${prefix}.usage.totalTokens`, errors, { positive: true });
  if (usage.cost !== undefined && !readMonetaryCost(usage.cost, "certification").ok) {
    invalid(`${prefix}.usage.cost`, errors);
  }
}

function validateQuality(value: unknown, index: number, errors: string[], expectedMaxScore?: number): void {
  const prefix = `row[${index}].quality`;
  const quality = recordAt(value, prefix, errors);
  if (!quality) return;
  if (typeof quality.passed !== "boolean") invalid(`${prefix}.passed`, errors);
  finiteAt(quality.score, `${prefix}.score`, errors, { nonnegative: true });
  finiteAt(quality.maxScore, `${prefix}.maxScore`, errors, { positive: true });
  finiteAt(quality.penalty, `${prefix}.penalty`, errors, { nonnegative: true });
  finiteAt(quality.rawScore, `${prefix}.rawScore`, errors, { nonnegative: true });
  if (typeof quality.maxScore === "number" && expectedMaxScore !== undefined && quality.maxScore !== expectedMaxScore) {
    invalid(`${prefix}.maxScore`, errors);
  }
  if (
    typeof quality.score === "number" &&
    typeof quality.maxScore === "number" &&
    Number.isFinite(quality.score) &&
    Number.isFinite(quality.maxScore) &&
    quality.score > quality.maxScore
  ) {
    invalid(`${prefix}.score`, errors);
  }
  if (
    typeof quality.score === "number" &&
    typeof quality.rawScore === "number" &&
    typeof quality.penalty === "number" &&
    Number.isFinite(quality.score) &&
    Number.isFinite(quality.rawScore) &&
    Number.isFinite(quality.penalty) &&
    quality.score !== Math.max(0, quality.rawScore - quality.penalty)
  ) {
    invalid(`${prefix}.rawScore`, errors);
  }
  if (
    typeof quality.rawScore === "number" &&
    typeof quality.maxScore === "number" &&
    Number.isFinite(quality.rawScore) &&
    Number.isFinite(quality.maxScore) &&
    quality.rawScore > quality.maxScore
  ) {
    invalid(`${prefix}.rawScore`, errors);
  }
}

function recordAt(value: unknown, field: string, errors: string[]): JsonRecord | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as JsonRecord;
  invalid(field, errors);
  return undefined;
}

function stringAt(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== "string" || !value.trim()) invalid(field, errors);
}

function integerAt(value: unknown, field: string, errors: string[], minimum?: number): void {
  if (!Number.isSafeInteger(value) || (minimum !== undefined && (value as number) < minimum)) invalid(field, errors);
}

function finiteAt(
  value: unknown,
  field: string,
  errors: string[],
  bounds: { nonnegative?: boolean; positive?: boolean },
): void {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (bounds.nonnegative && value < 0) ||
    (bounds.positive && value <= 0)
  ) {
    invalid(field, errors);
  }
}

function invalid(field: string, errors: string[]): void {
  errors.push(`Invalid certification runtime schema field: ${field}`);
}
