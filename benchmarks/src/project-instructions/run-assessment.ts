import {
  type TaskVerificationSemanticEvidence,
  taskVerificationSemanticFailure,
} from "./verification-semantic-proof.ts";

type CaptureOverflow = {
  kind?: unknown;
  captureName?: unknown;
  limitBytes?: unknown;
  limitCount?: unknown;
};

type SampleAssessment = {
  captureOverflow?: CaptureOverflow;
  liveness?: {
    semanticEvidenceAvailable?: unknown;
    semanticEvidenceComplete?: unknown;
    taskVerification?: TaskVerificationSemanticEvidence | null;
  };
  quality?: {
    checks?: Array<{ passed?: unknown }>;
    maxScore?: number;
    passed?: unknown;
    rawScore?: number;
    score?: number;
  };
  status?: string;
  taskVerificationMode?: "evidence" | "audit" | "off";
  metrics?: object;
};

type ExplicitRunTermination = { metrics?: unknown; status?: unknown };

export function describeExplicitRunTermination(sample: ExplicitRunTermination): string | undefined {
  if (sample.status === "timed_out" || sample.status === "skipped") return `run status ${sample.status}`;
  const metrics = sample.metrics as Record<string, unknown> | undefined;
  if (
    sample.status === "failed" &&
    Array.isArray(metrics?.errors) &&
    metrics.errors.some((error) => typeof error === "string" && error.trim().length > 0)
  ) {
    return "provider terminated before successful completion";
  }
  return undefined;
}

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
  const terminationFailure = describeExplicitRunTermination(sample);
  if (terminationFailure) return { passed: false, reason: terminationFailure };
  if (
    sample.liveness &&
    (sample.liveness.semanticEvidenceAvailable !== true || sample.liveness.semanticEvidenceComplete !== true)
  ) {
    return { passed: false, reason: "child benchmark semantic evidence is incomplete" };
  }
  if (sample.liveness) {
    if (!sample.taskVerificationMode) {
      return { passed: false, reason: "child benchmark task-verification profile is missing" };
    }
    if (!sample.liveness.taskVerification) {
      return { passed: false, reason: "child benchmark task-verification semantic evidence is missing" };
    }
    const failure = taskVerificationSemanticFailure(sample.taskVerificationMode, sample.liveness.taskVerification);
    if (failure) return { passed: false, reason: failure };
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
  if (sample.status === "failed" && qualityIsComplete && qualityFailed) {
    return { passed: false, reason: `quality gate failed (${rawScore ?? 0}/${quality?.maxScore ?? 0})` };
  }
  if (sample.status !== "passed") return { passed: false, reason: `run status ${sample.status}` };
  if (qualityFailed)
    return { passed: false, reason: `quality gate failed (${rawScore ?? 0}/${quality?.maxScore ?? 0})` };
  return { passed: true };
}
