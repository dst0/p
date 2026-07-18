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

export const STATUS_ORDER: readonly TaskStatus[] = ["todo", "doing", "done"];
