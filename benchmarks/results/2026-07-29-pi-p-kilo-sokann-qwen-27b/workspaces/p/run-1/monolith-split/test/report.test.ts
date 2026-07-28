import * as assert from "node:assert/strict";
import { test } from "node:test";
import type { Task, TaskSummary } from "../src/parser.js";
import {
  summarizeTasks,
  formatSummary,
  serializeTasks,
  renderDashboard,
  runReport,
  groupTasksByStatus,
  selectLargest,
} from "../src/report.js";

const tasks: Task[] = [
  { id: 1, title: "Alpha", status: "todo", estimate: 3, tags: ["code"] },
  { id: 2, title: "Beta", status: "doing", estimate: 5, tags: ["docs"] },
  { id: 3, title: "Gamma", status: "done", estimate: 2, tags: ["code", "docs"] },
];

test("summarizeTasks computes correct totals", () => {
  const summary = summarizeTasks(tasks);
  assert.equal(summary.total, 3);
  assert.equal(summary.completed, 1);
  assert.equal(summary.completionRate, 33);
  assert.equal(summary.totalEstimate, 10);
  assert.deepEqual(summary.byStatus, { todo: 1, doing: 1, done: 1 });
});

test("summarizeTasks handles empty task list", () => {
  const summary = summarizeTasks([]);
  assert.equal(summary.total, 0);
  assert.equal(summary.completed, 0);
  assert.equal(summary.completionRate, 0);
  assert.equal(summary.totalEstimate, 0);
});

test("summarizeTasks counts tags correctly", () => {
  const summary = summarizeTasks(tasks);
  assert.equal(summary.tagCounts.code, 2);
  assert.equal(summary.tagCounts.docs, 2);
});

test("formatSummary produces expected sections", () => {
  const summary: TaskSummary = {
    total: 3,
    completed: 1,
    completionRate: 33,
    totalEstimate: 10,
    byStatus: { todo: 1, doing: 1, done: 1 },
    tagCounts: { code: 2, docs: 2 },
  };
  const formatted = formatSummary(summary);
  assert.match(formatted, /^## Summary/);
  assert.match(formatted, /Total tasks: 3/);
  assert.match(formatted, /Completed: 1 \(33%\)/);
  assert.match(formatted, /Total estimate: 10/);
  assert.match(formatted, /TODO: 1/);
  assert.match(formatted, /DOING: 1/);
  assert.match(formatted, /DONE: 1/);
  assert.match(formatted, /Tags:/);
  assert.match(formatted, /- code: 2/);
  assert.match(formatted, /- docs: 2/);
});

test("serializeTasks returns pretty JSON with trailing newline", () => {
  const json = serializeTasks(tasks);
  assert.ok(json.endsWith("\n"));
  const parsed = JSON.parse(json);
  assert.equal(parsed.length, 3);
});

test("serializeTasks returns independent copies", () => {
  const json = serializeTasks(tasks);
  const parsed = JSON.parse(json);
  parsed[0].tags.push("new");
  assert.ok(!tasks[0].tags.includes("new"));
});

test("renderDashboard produces expected sections", () => {
  const dashboard = renderDashboard(tasks);
  assert.match(dashboard, /^# Task dashboard/);
  assert.match(dashboard, /Dataset checksum: \d+/);
  assert.match(dashboard, /## Tasks/);
});

test("runReport produces full report with title, summary, and tasks", () => {
  const input = "1|Alpha|todo|3|code\n2|Beta|done|5|docs";
  const report = runReport(input);
  assert.match(report, /^# Task report\n/);
  assert.match(report, /## Summary/);
  assert.match(report, /## Tasks/);
  assert.match(report, /Dataset checksum/);
});

test("groupTasksByStatus groups tasks into status buckets", () => {
  const groups = groupTasksByStatus(tasks);
  assert.equal(groups.todo.length, 1);
  assert.equal(groups.doing.length, 1);
  assert.equal(groups.done.length, 1);
  assert.equal(groups.todo[0].id, 1);
  assert.equal(groups.doing[0].id, 2);
  assert.equal(groups.done[0].id, 3);
});

test("selectLargest returns top N tasks by estimate", () => {
  const largest = selectLargest(tasks, 2);
  assert.equal(largest.length, 2);
  assert.equal(largest[0].id, 2); // estimate 5
  assert.equal(largest[1].id, 1); // estimate 3
});

test("selectLargest throws on invalid limit", () => {
  assert.throws(() => selectLargest(tasks, -1), { message: /Invalid limit/ });
  assert.throws(() => selectLargest(tasks, 1.5), { message: /Invalid limit/ });
});
