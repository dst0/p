import type { Task, TaskStatus, TaskSummary, ReportOptions, SortKey } from "./parser.js";
import { getTaskStatusOrder } from "./parser.js";
import { sortTasks, filterTasks } from "./query.js";
import { parseTaskFile, parseStatus, parseTags, normalizeTitleFromString } from "./parser.js";

function cloneTask(task: Task): Task {
  return { ...task, tags: [...task.tags] };
}

function normalizeTask(task: Task): Task {
  return {
    id: task.id,
    title: normalizeTitleFromString(task.title),
    status: parseStatus(task.status),
    estimate: Number(task.estimate),
    tags: parseTags(task.tags.join(",")),
  };
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

function formatPercent(value: number): string {
  return value.toFixed(0) + "%";
}

function formatStatusLine(status: TaskStatus, count: number): string {
  return status.toUpperCase() + ": " + count;
}

function formatTagLine(tag: string, count: number): string {
  return "- " + tag + ": " + count;
}

export function formatSummary(summary: TaskSummary): string {
  const statusLines = getTaskStatusOrder().map((status) => formatStatusLine(status, summary.byStatus[status]));
  const tagLines = Object.keys(summary.tagCounts).sort().map((tag) => formatTagLine(tag, summary.tagCounts[tag]));
  return [
    "## Summary",
    "Total tasks: " + summary.total,
    "Completed: " + summary.completed + " (" + formatPercent(summary.completionRate) + ")",
    "Total estimate: " + summary.totalEstimate,
    ...statusLines,
    tagLines.length > 0 ? "Tags:\n" + tagLines.join("\n") : "Tags: none",
  ].join("\n");
}

function formatTask(task: Task): string {
  const tags = task.tags.length > 0 ? " [" + task.tags.join(", ") + "]" : "";
  return "- #" + task.id + " " + task.title + " (" + task.status + ", " + task.estimate + ")" + tags;
}

function formatTaskTable(tasks: readonly Task[]): string {
  if (tasks.length === 0) return "## Tasks\nNo matching tasks.";
  return "## Tasks\n" + tasks.map(formatTask).join("\n");
}

function buildReportTitle(options: ReportOptions): string {
  const scope = options.query ? " for \"" + options.query + "\"" : "";
  return "# Task report" + scope;
}

function normalizeOptions(options: ReportOptions): ReportOptions {
  return {
    query: options.query?.trim() || undefined,
    status: options.status,
    tag: options.tag?.trim().toLowerCase() || undefined,
    sort: options.sort ?? "id",
  };
}

function checksum(tasks: readonly Task[]): number {
  return tasks.reduce((total, task) => total + task.id * 31 + task.title.length + task.estimate, 0);
}

function buildMetadata(tasks: readonly Task[]): string {
  return "Dataset checksum: " + checksum(tasks);
}

export function serializeTasks(tasks: readonly Task[]): string {
  return JSON.stringify(tasks.map(cloneTask), null, 2) + "\n";
}

export function renderDashboard(tasks: readonly Task[]): string {
  const ordered = sortTasks(tasks, "title");
  return ["# Task dashboard", buildMetadata(ordered), formatTaskTable(ordered)].join("\n\n") + "\n";
}

export function runReport(input: string, options: ReportOptions = {}): string {
  const normalizedOptions = normalizeOptions(options);
  const parsed = parseTaskFile(input);
  const selected = filterTasks(parsed, normalizedOptions);
  const ordered = sortTasks(selected, normalizedOptions.sort ?? "id");
  const summary = summarizeTasks(ordered);
  return [buildReportTitle(normalizedOptions), formatSummary(summary), buildMetadata(ordered), formatTaskTable(ordered)].join("\n\n") + "\n";
}
