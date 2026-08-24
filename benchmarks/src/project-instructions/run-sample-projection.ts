import type { PairedSample } from "./run-core.ts";

type SampleInput = Record<string, unknown> & {
  usage?: SampleInput;
  model?: SampleInput;
  metrics?: SampleInput;
  quality?: SampleInput;
  captureOverflow?: SampleInput;
  checks?: SampleInput[];
};

type ProjectedChildSample = {
  agent: string;
  task: string;
  status: string;
  elapsedMs: number;
  captureOverflow?: PairedSample["captureOverflow"];
  projectInstructionEvidence: unknown;
  metrics: PairedSample["metrics"];
  quality: PairedSample["quality"];
};

const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

function projectUsage(usage: SampleInput | undefined) {
  const projected = {
    input: number(usage?.input),
    output: number(usage?.output),
    cacheRead: number(usage?.cacheRead),
    cacheWrite: number(usage?.cacheWrite),
    totalTokens: number(usage?.totalTokens),
  };
  return Object.values(projected).every((value) => value !== undefined && value >= 0) ? projected : undefined;
}

function projectMetrics(metrics: SampleInput | undefined) {
  const usage = projectUsage(metrics?.usage);
  if (
    !usage ||
    typeof metrics?.model?.provider !== "string" ||
    typeof metrics.model.id !== "string" ||
    typeof metrics.model.api !== "string" ||
    (metrics.responseModel !== undefined && typeof metrics.responseModel !== "string")
  ) {
    return undefined;
  }
  return {
    model: { provider: metrics.model.provider, id: metrics.model.id, api: metrics.model.api },
    responseModel: metrics.responseModel,
    usage,
  };
}

function projectQuality(quality: SampleInput | undefined) {
  if (
    typeof quality?.passed !== "boolean" ||
    ![quality.score, quality.maxScore, quality.rawScore].every((value) => number(value) !== undefined) ||
    !Array.isArray(quality.checks) ||
    quality.checks.length === 0 ||
    quality.checks.some(
      (check) =>
        typeof check?.name !== "string" || typeof check.passed !== "boolean" || number(check.weight) === undefined,
    )
  ) {
    return undefined;
  }
  return {
    passed: quality.passed,
    score: quality.score,
    maxScore: quality.maxScore,
    rawScore: quality.rawScore,
    checks: quality.checks.map((check) => ({ name: check.name, passed: check.passed, weight: check.weight })),
  };
}

function projectCaptureOverflow(value: SampleInput | undefined) {
  if (value === undefined) return undefined;
  if (
    value?.kind !== "capture_overflow" ||
    typeof value.captureName !== "string" ||
    (value.limitBytes !== undefined && number(value.limitBytes) === undefined) ||
    (value.observedBytesAtLeast !== undefined && number(value.observedBytesAtLeast) === undefined) ||
    (value.limitCount !== undefined && number(value.limitCount) === undefined) ||
    (value.observedCountAtLeast !== undefined && number(value.observedCountAtLeast) === undefined) ||
    (value.turn !== undefined && number(value.turn) === undefined)
  ) {
    return undefined;
  }
  return {
    kind: value.kind,
    captureName: value.captureName,
    limitBytes: value.limitBytes,
    observedBytesAtLeast: value.observedBytesAtLeast,
    limitCount: value.limitCount,
    observedCountAtLeast: value.observedCountAtLeast,
    turn: value.turn,
  };
}

export function projectPairedChildSample(
  result: SampleInput | undefined,
  projectInstructionEvidence: unknown,
): ProjectedChildSample | undefined {
  const metrics = projectMetrics(result?.metrics);
  const quality = projectQuality(result?.quality);
  const captureOverflow = projectCaptureOverflow(result?.captureOverflow);
  const elapsedMs = number(result?.elapsedMs);
  if (
    !metrics ||
    !quality ||
    (result?.captureOverflow !== undefined && !captureOverflow) ||
    typeof result?.agent !== "string" ||
    typeof result.task !== "string" ||
    typeof result.status !== "string" ||
    !["passed", "failed", "timed_out"].includes(result.status) ||
    elapsedMs === undefined
  ) {
    return undefined;
  }
  return {
    agent: result.agent,
    task: result.task,
    status: result.status,
    elapsedMs,
    captureOverflow,
    projectInstructionEvidence,
    metrics,
    quality,
  } as ProjectedChildSample;
}
