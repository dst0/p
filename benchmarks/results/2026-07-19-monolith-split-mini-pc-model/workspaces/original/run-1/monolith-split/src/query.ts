import type { Task, TaskStatus, SortKey, ReportOptions, TaskSummary } from "./shared.js";
import { cloneTask } from "./shared.js";
import { normalizeTitle, parseStatus, parseEstimate, parseTags } from "./parser.js";

function normalizeTask(task: Task): Task {
  return {
    id: task.id,
    title: normalizeTitle(task.title),
    status: parseStatus(task.status),
    estimate: parseEstimate(String(task.estimate)),
    tags: parseTags(task.tags.join(",")),
  };
}

function matchesStatus(task: Task, status: TaskStatus | undefined): boolean {
  return status === undefined || task.status === status;
}

function matchesTag(task: Task, tag: string | undefined): boolean {
  return tag === undefined || task.tags.includes(tag.toLowerCase());
}

function matchesQuery(task: Task, query: string | undefined): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return task.title.toLowerCase().includes(needle) || task.tags.some((tag) => tag.includes(needle));
}

export function filterTasks(tasks: readonly Task[], options: ReportOptions = {}): Task[] {
  return tasks
    .map(normalizeTask)
    .filter((task) => matchesStatus(task, options.status))
    .filter((task) => matchesTag(task, options.tag))
    .filter((task) => matchesQuery(task, options.query))
    .map(cloneTask);
}

function compareNumbers(left: number, right: number): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en", { sensitivity: "base" });
}

function compareTasks(left: Task, right: Task, key: SortKey): number {
  if (key === "title") return compareText(left.title, right.title) || compareNumbers(left.id, right.id);
  if (key === "estimate") return compareNumbers(left.estimate, right.estimate) || compareNumbers(left.id, right.id);
  return compareNumbers(left.id, right.id);
}

export function sortTasks(tasks: readonly Task[], key: SortKey = "id"): Task[] {
  return tasks.map(cloneTask).sort((left, right) => compareTasks(left, right, key));
}

function countStatuses(tasks: readonly Task[]): Record<TaskStatus, number> {
  const counts: Record<TaskStatus, number> = { todo: 0, doing: 0, done: 0 };
  for (const task of tasks) counts[task.status] += 1;
  return counts;
}

function countTags(tasks: readonly Task[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const task of tasks) {
    for (const tag of task.tags) counts[tag] = (counts[tag] ?? 0) + 1;
  }
  return counts;
}

function calculateCompletionRate(total: number, completed: number): number {
  return total === 0 ? 0 : Math.round((completed / total) * 100);
}

export function summarizeTasks(tasks: readonly Task[]): TaskSummary {
  const normalized = tasks.map(normalizeTask);
  const byStatus = countStatuses(normalized);
  const completed = byStatus.done;
  return {
    total: normalized.length,
    completed,
    completionRate: calculateCompletionRate(normalized.length, completed),
    totalEstimate: normalized.reduce((total, task) => total + task.estimate, 0),
    byStatus,
    tagCounts: countTags(normalized),
  };
}

export function groupTasksByStatus(tasks: readonly Task[]): Record<TaskStatus, Task[]> {
  const groups: Record<TaskStatus, Task[]> = { todo: [], doing: [], done: [] };
  for (const task of tasks) groups[task.status].push(cloneTask(task));
  return groups;
}

export function selectLargest(tasks: readonly Task[], limit: number): Task[] {
  if (!Number.isInteger(limit) || limit < 0) throw new Error("Invalid limit");
  return sortTasks(tasks, "estimate").slice(-limit).reverse();
}
