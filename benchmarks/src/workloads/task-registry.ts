import { calculatorTask } from "./calculator.ts";
import { durableWorkflowTask } from "./durable-workflow.ts";
import { inventoryTask } from "./inventory.ts";
import { monolithSplitTask } from "./monolith-split.ts";
import type { BenchmarkTask } from "./task-definition.ts";

export const benchmarkTasks: readonly BenchmarkTask[] = [
  calculatorTask,
  monolithSplitTask,
  inventoryTask,
  durableWorkflowTask,
];

export function createTaskBaseline(task: BenchmarkTask): Readonly<Record<string, string>> {
  return { ...task.files };
}
