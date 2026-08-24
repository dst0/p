type CaptureOverflow = {
  kind?: unknown;
  captureName?: unknown;
  limitBytes?: unknown;
  limitCount?: unknown;
};

type SampleAssessment = {
  captureOverflow?: CaptureOverflow;
  liveness?: { semanticEvidenceAvailable?: unknown; semanticEvidenceComplete?: unknown };
  quality?: {
    checks?: Array<{ passed?: unknown }>;
    maxScore?: number;
    passed?: unknown;
    rawScore?: number;
    score?: number;
  };
  status?: string;
};

export function describeCaptureOverflow(
  captureOverflow: CaptureOverflow | undefined,
  scope?: string,
): string | undefined {
  if (captureOverflow?.kind !== "capture_overflow") return undefined;
  const captureName = typeof captureOverflow.captureName === "string" ? captureOverflow.captureName : "unknown capture";
  const limit = Number.isSafeInteger(captureOverflow.limitBytes)
    ? `${captureOverflow.limitBytes} bytes`
    : Number.isSafeInteger(captureOverflow.limitCount)
      ? `${captureOverflow.limitCount} entries`
      : "its configured limit";
  return `${scope ? `${scope} ` : ""}capture overflow: ${captureName} exceeded ${limit}`;
}

export function assessSample(sample: SampleAssessment): { passed: boolean; reason?: string } {
  const captureFailure = describeCaptureOverflow(sample.captureOverflow);
  if (captureFailure) return { passed: false, reason: captureFailure };
  if (
    sample.liveness &&
    (sample.liveness.semanticEvidenceAvailable !== true || sample.liveness.semanticEvidenceComplete !== true)
  ) {
    return { passed: false, reason: "child benchmark semantic evidence is incomplete" };
  }
  const quality = sample.quality;
  const checksPass =
    Array.isArray(quality?.checks) &&
    quality.checks.length > 0 &&
    quality.checks.every((check) => check.passed === true);
  const rawScore = quality?.rawScore ?? quality?.score;
  const scoresAreComplete =
    typeof rawScore === "number" &&
    Number.isFinite(rawScore) &&
    typeof quality?.maxScore === "number" &&
    Number.isFinite(quality.maxScore) &&
    quality.maxScore > 0;
  const qualityIsComplete = Array.isArray(quality?.checks) && quality.checks.length > 0 && scoresAreComplete;
  const qualityFailed = quality?.passed !== true || !checksPass || !scoresAreComplete || rawScore !== quality.maxScore;
  if (["timed_out", "skipped"].includes(sample.status ?? "")) {
    return { passed: false, reason: `run status ${sample.status}` };
  }
  if (sample.status === "failed" && qualityIsComplete && qualityFailed) {
    return { passed: false, reason: `quality gate failed (${rawScore ?? 0}/${quality?.maxScore ?? 0})` };
  }
  if (sample.status !== "passed") return { passed: false, reason: `run status ${sample.status}` };
  if (qualityFailed)
    return { passed: false, reason: `quality gate failed (${rawScore ?? 0}/${quality?.maxScore ?? 0})` };
  return { passed: true };
}
