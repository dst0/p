// Compatibility facade — re-exports the full public API from the split modules.
// Consumers can keep importing from this path without any changes.

export type { TaskStatus, SortKey, Task, TaskSummary, ReportOptions } from "./shared.js";

export {
  parseTaskLine,
  parseTaskFile,
} from "./parser.js";

export {
  filterTasks,
  sortTasks,
  summarizeTasks,
  groupTasksByStatus,
  selectLargest,
} from "./query.js";

export {
  formatSummary,
  serializeTasks,
  renderDashboard,
  runReport,
} from "./report.js";
