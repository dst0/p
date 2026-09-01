import { createHash } from "node:crypto";

export const PROJECT_INSTRUCTION_CONDITIONS = ["legacy", "compiled-evidence", "compiled-audit"] as const;
export const DEFAULT_PROJECT_INSTRUCTION_CONDITIONS = ["legacy", "compiled-evidence"] as const;
export type ProjectInstructionCondition = (typeof PROJECT_INSTRUCTION_CONDITIONS)[number];
export type ProjectInstructionMode = "compiled" | "legacy";
export type TaskVerificationMode = "evidence" | "audit" | "off";
export type PairedScheduleCell = { run: number; task: string; conditions: ProjectInstructionCondition[] };

type ConditionConfiguration = {
  projectInstructionMode: ProjectInstructionMode;
  taskVerificationMode: TaskVerificationMode;
};

const CONFIGURATIONS: Record<ProjectInstructionCondition, ConditionConfiguration> = {
  legacy: { projectInstructionMode: "legacy", taskVerificationMode: "evidence" },
  "compiled-evidence": { projectInstructionMode: "compiled", taskVerificationMode: "evidence" },
  "compiled-audit": { projectInstructionMode: "compiled", taskVerificationMode: "audit" },
};

function validateSelectedConditions(task: string, conditions: readonly ProjectInstructionCondition[]): void {
  if (conditions.length !== 2 && conditions.length !== 3) {
    throw new Error(`Expected two release conditions or all three conditions with the audit canary for ${task}`);
  }
  for (const condition of conditions) {
    if (!PROJECT_INSTRUCTION_CONDITIONS.includes(condition)) {
      throw new Error(`Unknown benchmark condition ${condition} for ${task}`);
    }
  }
  if (new Set(conditions).size !== conditions.length) throw new Error(`Duplicate benchmark condition for ${task}`);
  const expected = conditions.length === 2 ? DEFAULT_PROJECT_INSTRUCTION_CONDITIONS : PROJECT_INSTRUCTION_CONDITIONS;
  if (expected.some((condition) => !conditions.includes(condition))) {
    throw new Error(`Benchmark conditions for ${task} must be exactly ${expected.join(", ")} in any order`);
  }
}

export function conditionConfiguration(condition: ProjectInstructionCondition): ConditionConfiguration {
  return CONFIGURATIONS[condition];
}

function seededBaseOrder(
  seed: string,
  task: string,
  conditions: readonly ProjectInstructionCondition[],
): ProjectInstructionCondition[] {
  return [...conditions]
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
  conditions: readonly ProjectInstructionCondition[] = DEFAULT_PROJECT_INSTRUCTION_CONDITIONS,
): ProjectInstructionCondition[][] {
  validateSelectedConditions(task, conditions);
  const [first, second, third] = seededBaseOrder(seed, task, conditions);
  if (!first || !second) throw new Error(`Missing paired condition schedule for ${task}`);
  if (!third) {
    const orders = [
      [first, second],
      [second, first],
    ];
    return Array.from({ length: runs }, (_, index) => [...orders[index % orders.length]!]);
  }
  return [
    [first, second, third],
    [second, third, first],
    [third, first, second],
    [third, second, first],
    [first, third, second],
  ].slice(0, runs);
}

export function buildPairedSchedule(
  tasks: string[],
  runs: number,
  seed: string,
  conditions: readonly ProjectInstructionCondition[] = DEFAULT_PROJECT_INSTRUCTION_CONDITIONS,
): PairedScheduleCell[] {
  const schedulesByTask = new Map<string, ProjectInstructionCondition[][]>();
  for (const task of tasks) {
    schedulesByTask.set(task, buildBalancedConditionOrders(seed, task, runs, conditions));
  }
  return Array.from({ length: runs }, (_, index) =>
    tasks.map((task) => {
      const scheduledConditions = schedulesByTask.get(task)?.[index];
      if (!scheduledConditions) throw new Error(`Missing randomized schedule for ${task}`);
      return { run: index + 1, task, conditions: scheduledConditions };
    }),
  ).flat();
}
