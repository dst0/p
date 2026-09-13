import type { BenchmarkRowLike } from "../../src/workloads/certification.ts";
import { benchmarkTasks } from "../../src/workloads/task-registry.ts";

export interface SyntheticRowOptions {
  runs?: number;
  agents?: readonly string[];
  responseModel?: string;
  pDurationMs?: number;
  baselineDurationMs?: number;
  pTokens?: number;
  baselineTokens?: number;
  pCost?: number;
  baselineCost?: number;
  pScoreFraction?: number;
  pPenalty?: number;
  pNudges?: number;
  modifyCell?: (row: BenchmarkRowLike) => BenchmarkRowLike | undefined;
}

export function createSyntheticCertifiedMatrix(options: SyntheticRowOptions = {}): BenchmarkRowLike[] {
  const totalRuns = options.runs ?? 3;
  const agents = options.agents ?? ["p", "pi", "kilo"];
  const tasks = benchmarkTasks;
  const model = options.responseModel ?? "resolved/test-model";
  const rows: BenchmarkRowLike[] = [];

  for (let run = 1; run <= totalRuns; run += 1) {
    for (const agent of agents) {
      for (const task of tasks) {
        const isP = agent === "p";
        const duration = isP ? (options.pDurationMs ?? 900) : (options.baselineDurationMs ?? 1000);
        const tokens = isP ? (options.pTokens ?? 180) : (options.baselineTokens ?? 200);
        const costAmount = isP ? (options.pCost ?? 0.04) : (options.baselineCost ?? 0.05);
        const maxScore = task.maxScore;
        const scoreFraction = isP ? (options.pScoreFraction ?? 1.0) : 1.0;
        const score = Math.round(maxScore * scoreFraction);
        const penalty = isP ? (options.pPenalty ?? 0) : 0;
        const nudges = isP ? (options.pNudges ?? 0) : 0;

        let row: BenchmarkRowLike = {
          run,
          agent,
          task: task.id,
          status: "passed",
          elapsedMs: duration,
          exitCode: 0,
          timedOut: false,
          nudges,
          metrics: {
            usage: {
              input: Math.floor(tokens / 2),
              output: Math.ceil(tokens / 2),
              totalTokens: tokens,
              cacheRead: 0,
              cacheWrite: 0,
              cost: { total: costAmount },
            },
            toolCalls: 5,
            toolErrors: 0,
            errors: [],
            responseModel: model,
            responseModels: [model],
          },
          quality: {
            passed: score === maxScore && penalty === 0,
            score: Math.max(0, score - penalty),
            maxScore,
            penalty,
            rawScore: score,
          },
        };

        if (options.modifyCell) {
          const modified = options.modifyCell(row);
          if (modified !== undefined) row = modified;
          else continue;
        }

        rows.push(row);
      }
    }
  }

  return rows;
}
