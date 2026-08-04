// Compatibility facade — re-exports every public symbol from the split modules.
// Existing consumers can continue importing from "./monolith" without changes.

export type {
  TaskStatus,
  SortKey,
  Task,
  TaskSummary,
  ReportOptions,
} from "./types.js";

export {
  STATUS_ORDER,
} from "./types.js";

export {
  parseTaskLine,
  parseTaskFile,
  cloneTask,
  normalizeTask,
  parseId,
  parseStatus,
  parseEstimate,
  parseTags,
  normalizeTitle,
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
