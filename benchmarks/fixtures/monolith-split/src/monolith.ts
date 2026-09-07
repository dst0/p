export type TaskStatus = "todo" | "doing" | "done";
export type SortKey = "id" | "title" | "estimate";

export interface Task {
  id: number;
  title: string;
  status: TaskStatus;
  estimate: number;
  tags: string[];
}

export interface TaskSummary {
  total: number;
  completed: number;
  completionRate: number;
  totalEstimate: number;
  byStatus: Record<TaskStatus, number>;
  tagCounts: Record<string, number>;
}

export interface ReportOptions {
  query?: string;
  status?: TaskStatus;
  tag?: string;
  sort?: SortKey;
}

const STATUS_ORDER: readonly TaskStatus[] = ["todo", "doing", "done"];

function requireField(value: string | undefined, field: string): string {
  const result = value?.trim() ?? "";
  if (!result) throw new Error("Missing " + field);
  return result;
}

function parseId(value: string | undefined): number {
  const parsed = Number.parseInt(requireField(value, "id"), 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error("Invalid task id");
  return parsed;
}

function parseStatus(value: string | undefined): TaskStatus {
  const status = requireField(value, "status").toLowerCase();
  if (!STATUS_ORDER.includes(status as TaskStatus)) throw new Error("Invalid task status");
  return status as TaskStatus;
}

function parseEstimate(value: string | undefined): number {
  const estimate = Number(requireField(value, "estimate"));
  if (!Number.isFinite(estimate) || estimate < 0) throw new Error("Invalid estimate");
  return estimate;
}

function parseTags(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return [...new Set(value.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
}

function normalizeTitle(value: string | undefined): string {
  return requireField(value, "title").replaceAll(/\s+/g, " ");
}

export function parseTaskLine(line: string): Task {
  const fields = line.split("|");
  if (fields.length < 5) throw new Error("Invalid task line");
  return {
    id: parseId(fields[0]),
    title: normalizeTitle(fields[1]),
    status: parseStatus(fields[2]),
    estimate: parseEstimate(fields[3]),
    tags: parseTags(fields.slice(4).join("|")),
  };
}

export function parseTaskFile(input: string): Task[] {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map(parseTaskLine);
}

function cloneTask(task: Task): Task {
  return { ...task, tags: [...task.tags] };
}

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

export function groupTasksByStatus(tasks: readonly Task[]): Record<TaskStatus, Task[]> {
  const groups: Record<TaskStatus, Task[]> = { todo: [], doing: [], done: [] };
  for (const task of tasks) groups[task.status].push(cloneTask(task));
  return groups;
}

export function selectLargest(tasks: readonly Task[], limit: number): Task[] {
  if (!Number.isInteger(limit) || limit < 0) throw new Error("Invalid limit");
  return sortTasks(tasks, "estimate").slice(-limit).reverse();
}
