// Compatibility facade — re-exports every public symbol so existing
// import paths continue to work without changes.

export type {
  TaskStatus,
  SortKey,
  Task,
  TaskSummary,
  ReportOptions,
} from "./parser.js";

export {
  parseTaskLine,
  parseTaskFile,
} from "./parser.js";

export {
  filterTasks,
  sortTasks,
  groupTasksByStatus,
  selectLargest,
} from "./query.js";

export {
  summarizeTasks,
  formatSummary,
  serializeTasks,
  renderDashboard,
  runReport,
} from "./report.js";
