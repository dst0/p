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

export function getTaskStatusOrder(): readonly TaskStatus[] {
  return STATUS_ORDER;
}

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

export function parseStatus(value: string | undefined): TaskStatus {
  const status = requireField(value, "status").toLowerCase();
  if (!STATUS_ORDER.includes(status as TaskStatus)) throw new Error("Invalid task status");
  return status as TaskStatus;
}

function parseEstimate(value: string | undefined): number {
  const estimate = Number(requireField(value, "estimate"));
  if (!Number.isFinite(estimate) || estimate < 0) throw new Error("Invalid estimate");
  return estimate;
}

export function parseTags(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return [...new Set(value.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
}

function normalizeTitle(value: string | undefined): string {
  return requireField(value, "title").replaceAll(/\s+/g, " ");
}

export function normalizeTitleFromString(value: string): string {
  return value.trim().replaceAll(/\s+/g, " ");
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
