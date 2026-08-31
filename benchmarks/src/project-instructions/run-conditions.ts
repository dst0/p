import { createHash } from "node:crypto";

export const PROJECT_INSTRUCTION_CONDITIONS = ["legacy", "compiled-evidence", "compiled-audit"] as const;
export type ProjectInstructionCondition = (typeof PROJECT_INSTRUCTION_CONDITIONS)[number];
export type ProjectInstructionMode = "compiled" | "legacy";
export type TaskVerificationMode = "evidence" | "audit" | "off";

type ConditionConfiguration = {
  projectInstructionMode: ProjectInstructionMode;
  taskVerificationMode: TaskVerificationMode;
};

const CONFIGURATIONS: Record<ProjectInstructionCondition, ConditionConfiguration> = {
  legacy: { projectInstructionMode: "legacy", taskVerificationMode: "evidence" },
  "compiled-evidence": { projectInstructionMode: "compiled", taskVerificationMode: "evidence" },
  "compiled-audit": { projectInstructionMode: "compiled", taskVerificationMode: "audit" },
};

export function conditionConfiguration(condition: ProjectInstructionCondition): ConditionConfiguration {
  return CONFIGURATIONS[condition];
}

function seededBaseOrder(seed: string, task: string): ProjectInstructionCondition[] {
  return [...PROJECT_INSTRUCTION_CONDITIONS]
    .map((condition) => ({
      condition,
      order: createHash("sha256").update(`${seed}\0${task}\0${condition}`).digest("hex"),
    }))
    .sort((left, right) => left.order.localeCompare(right.order))
    .map(({ condition }) => condition);
}

export function buildBalancedConditionOrders(
  seed: string,
  task: string,
  runs: number,
): ProjectInstructionCondition[][] {
  const [first, second, third] = seededBaseOrder(seed, task);
  if (!first || !second || !third) throw new Error(`Missing three-condition schedule for ${task}`);
  const orders = [
    [first, second, third],
    [second, third, first],
    [third, first, second],
    [third, second, first],
    [first, third, second],
  ];
  return orders.slice(0, runs);
}
