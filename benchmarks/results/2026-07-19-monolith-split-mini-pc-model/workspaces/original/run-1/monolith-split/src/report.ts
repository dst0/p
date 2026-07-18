import type { Task, TaskSummary, ReportOptions } from "./shared.js";
import { STATUS_ORDER, cloneTask } from "./shared.js";
import { parseTaskFile } from "./parser.js";
import { filterTasks, sortTasks, summarizeTasks } from "./query.js";

function formatPercent(value: number): string {
  return value.toFixed(0) + "%";
}

function formatStatusLine(status: string, count: number): string {
  return status.toUpperCase() + ": " + count;
}

function formatTagLine(tag: string, count: number): string {
  return "- " + tag + ": " + count;
}

export function formatSummary(summary: TaskSummary): string {
  const statusLines = STATUS_ORDER.map((status) => formatStatusLine(status, summary.byStatus[status]));
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
  const ordered = sortTasks(selected, normalizedOptions.sort);
  const summary = summarizeTasks(ordered);
  return [buildReportTitle(normalizedOptions), formatSummary(summary), buildMetadata(ordered), formatTaskTable(ordered)].join("\n\n") + "\n";
}
