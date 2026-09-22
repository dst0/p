import { isBenchmarkProcessTerminationUnconfirmedError } from "../harness/process-termination-error.ts";
import { evaluateSealedHoldoutTask, type SealedHoldoutExecutionControl } from "./certification-holdout-execution.ts";
import { recheckSealedHoldoutPlan, type SealedHoldoutPlan } from "./certification-holdout-plan.ts";
import { type CertifiedTaskId, certifiedTaskMaxScoreFor } from "./certified-task-score-policy.ts";
import type { BenchmarkTask, BenchmarkTaskResult } from "./task-definition.ts";

export type CertifiedSealedHoldout = {
  plan: SealedHoldoutPlan;
  holdoutSha256: string;
  executionControl?: SealedHoldoutExecutionControl;
};

const holdoutWeights: Readonly<Record<string, number>> = {
  "typescript-calculator": 2,
  "monolith-split": 2,
  "event-sourced-inventory": 8,
  "durable-workflow-saga": 12,
};

export function createCertifiedTaskVariants(
  tasks: readonly BenchmarkTask[],
  holdout: CertifiedSealedHoldout,
): BenchmarkTask[] {
  const plans = new Map(holdout.plan.taskPlans.map((plan) => [plan.taskId, plan]));
  if (tasks.length !== plans.size || tasks.some((task) => !plans.has(task.id as CertifiedTaskId))) {
    throw new Error("Sealed holdout task plan does not match the certified task matrix");
  }
  return tasks.map((task) => {
    const taskId = task.id as CertifiedTaskId;
    const plan = plans.get(taskId);
    const maxScore = certifiedTaskMaxScoreFor(taskId);
    const weight = holdoutWeights[task.id];
    if (!plan || maxScore === undefined || weight === undefined || task.maxScore + weight !== maxScore) {
      throw new Error(`Sealed holdout score policy is invalid for task ${task.id}`);
    }
    return {
      ...task,
      maxScore,
      files: task.files,
      prompt: task.prompt,
      verify: async (workspace, baseline, finalText, context): Promise<BenchmarkTaskResult> => {
        const base = await task.verify(workspace, baseline, finalText, context);
        const holdoutPassed = await evaluatePlan(workspace, context?.evaluator, holdout, plan);
        return {
          ...base,
          passed: base.passed && holdoutPassed,
          score: base.score + (holdoutPassed ? weight : 0),
          maxScore,
          checks: [...base.checks, { name: "sealed evaluator holdout", passed: holdoutPassed, weight }],
        };
      },
    };
  });
}

async function evaluatePlan(
  workspace: string,
  evaluator: { path: string; sha256: string } | undefined,
  holdout: CertifiedSealedHoldout,
  plan: SealedHoldoutPlan["taskPlans"][number],
): Promise<boolean> {
  if (!evaluator) return false;
  try {
    recheckSealedHoldoutPlan(evaluator, holdout.plan.coreCandidateSha256, holdout.holdoutSha256);
    const passed = await evaluateSealedHoldoutTask(evaluator.path, workspace, plan, holdout.executionControl);
    recheckSealedHoldoutPlan(evaluator, holdout.plan.coreCandidateSha256, holdout.holdoutSha256);
    return passed;
  } catch (error) {
    if (isBenchmarkProcessTerminationUnconfirmedError(error)) throw error;
    return false;
  }
}
