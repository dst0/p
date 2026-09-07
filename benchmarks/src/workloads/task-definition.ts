export type BenchmarkCheck = {
  name: string;
  passed: boolean;
  weight: number;
  details?: string;
};

export type BenchmarkTaskResult = {
  passed: boolean;
  score: number;
  maxScore: number;
  checks: BenchmarkCheck[];
  rawScore?: number;
  penalty?: number;
  nudges?: number;
  finishNotesCreated?: boolean;
};

export type BenchmarkTask = {
  id: string;
  timeoutSeconds: number;
  maxScore: number;
  description: string;
  files: Readonly<Record<string, string>>;
  prompt: string;
  verify: (workspace: string, baseline: Readonly<Record<string, string>>, finalText: string) => BenchmarkTaskResult;
};

export function createTaskResult(
  passed: boolean,
  checks: ReadonlyArray<Omit<BenchmarkCheck, "weight"> & { weight?: number }>,
  expectedMaxScore?: number,
): BenchmarkTaskResult {
  const weightedChecks = checks.map((check) => ({ weight: 1, ...check }));
  const score = weightedChecks.reduce((total, check) => total + (check.passed ? check.weight : 0), 0);
  const maxScore = weightedChecks.reduce((total, check) => total + check.weight, 0);
  if (expectedMaxScore !== undefined && maxScore !== expectedMaxScore) {
    throw new Error(`Benchmark scoring changed: expected ${expectedMaxScore}, received ${maxScore}`);
  }
  return { passed, score, maxScore, checks: weightedChecks };
}
