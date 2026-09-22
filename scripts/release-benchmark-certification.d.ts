export interface BenchmarkCertificationEvidence {
  targetVersion: string;
  resultSha256: string;
  reportSha256: string;
  matrix: {
    agents: string[];
    tasks: string[];
    runs: number;
    cellCount: number;
    expectedResolvedModel: string;
  };
  binding: Record<string, string>;
  thresholds: {
    maxDurationRatio: number;
    maxTokenRatio: number;
    maxCostRatio: number | null;
  };
  createdAt: string;
}

export function persistBenchmarkCertification(
  repoRoot: string,
  evidence: BenchmarkCertificationEvidence,
  artifacts: { resultPath: string; reportPath: string },
): unknown;
