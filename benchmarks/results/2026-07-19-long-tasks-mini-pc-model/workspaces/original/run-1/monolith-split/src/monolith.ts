// Compatibility facade — re-exports the full public API from the split modules.
// Existing consumers can keep importing from this path without changes.

export type { TaskStatus, SortKey, Task, TaskSummary, ReportOptions } from "./types.js";
export { parseTaskLine, parseTaskFile } from "./parser.js";
export { filterTasks, sortTasks, groupTasksByStatus, selectLargest } from "./query.js";
export { summarizeTasks, formatSummary, serializeTasks, renderDashboard, runReport } from "./report.js";
