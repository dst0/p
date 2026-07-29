// Compatibility facade — preserves every public export and import path
export type { TaskStatus, SortKey, Task, TaskSummary, ReportOptions } from "./types.js";
export { parseTaskLine, parseTaskFile } from "./parser.js";
export { filterTasks, sortTasks, groupTasksByStatus, selectLargest } from "./query.js";
export { summarizeTasks, formatSummary, serializeTasks, renderDashboard, runReport } from "./report.js";
