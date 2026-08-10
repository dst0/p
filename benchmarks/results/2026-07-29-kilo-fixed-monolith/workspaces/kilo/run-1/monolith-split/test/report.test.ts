import * as assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeTasks, formatSummary, serializeTasks, renderDashboard, runReport } from "../src/report.js";
import { Task, TaskSummary } from "../src/types.js";

const tasks: Task[] = [
  { id: 1, title: "Alpha", status: "todo", estimate: 3, tags: ["code"] },
  { id: 2, title: "Beta", status: "done", estimate: 5, tags: ["docs"] },
  { id: 3, title: "Gamma", status: "doing", estimate: 2, tags: ["code", "docs"] },
];

test("summarizeTasks computes correct totals", () => {
  const summary = summarizeTasks(tasks);
  assert.equal(summary.total, 3);
  assert.equal(summary.completed, 1);
  assert.equal(summary.completionRate, 33);
  assert.equal(summary.totalEstimate, 10);
});

test("summarizeTasks counts by status", () => {
  const summary = summarizeTasks(tasks);
  assert.equal(summary.byStatus.todo, 1);
  assert.equal(summary.byStatus.doing, 1);
  assert.equal(summary.byStatus.done, 1);
});

test("summarizeTasks counts tags", () => {
  const summary = summarizeTasks(tasks);
  assert.equal(summary.tagCounts.code, 2);
  assert.equal(summary.tagCounts.docs, 2);
});

test("summarizeTasks with empty input", () => {
  const summary = summarizeTasks([]);
  assert.equal(summary.total, 0);
  assert.equal(summary.completed, 0);
  assert.equal(summary.completionRate, 0);
  assert.equal(summary.totalEstimate, 0);
});

test("formatSummary produces expected structure", () => {
  const summary: TaskSummary = {
    total: 3,
    completed: 1,
    completionRate: 33,
    totalEstimate: 10,
    byStatus: { todo: 1, doing: 1, done: 1 },
    tagCounts: { code: 2, docs: 2 },
  };
  const output = formatSummary(summary);
  assert.match(output, /^## Summary/m);
  assert.match(output, /Total tasks: 3/);
  assert.match(output, /Completed: 1 \(33%\)/);
  assert.match(output, /Total estimate: 10/);
  assert.match(output, /TODO: 1/);
  assert.match(output, /DOING: 1/);
  assert.match(output, /DONE: 1/);
  assert.match(output, /Tags:/);
  assert.match(output, /- code: 2/);
  assert.match(output, /- docs: 2/);
});

test("formatSummary with no tags shows 'Tags: none'", () => {
  const summary: TaskSummary = {
    total: 1,
    completed: 0,
    completionRate: 0,
    totalEstimate: 5,
    byStatus: { todo: 1, doing: 0, done: 0 },
    tagCounts: {},
  };
  assert.match(formatSummary(summary), /Tags: none/);
});

test("serializeTasks produces valid JSON", () => {
  const output = serializeTasks(tasks);
  const parsed = JSON.parse(output.slice(0, -1));
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].id, 1);
});

test("serializeTasks produces deep copies", () => {
  const output = serializeTasks(tasks);
  const parsed = JSON.parse(output.slice(0, -1));
  parsed[0].tags.push("injected");
  assert.equal(tasks[0].tags.length, 1);
});

test("renderDashboard produces expected structure", () => {
  const output = renderDashboard(tasks);
  assert.match(output, /^# Task dashboard/m);
  assert.match(output, /Dataset checksum:/);
  assert.match(output, /## Tasks/);
});

test("renderDashboard with empty tasks", () => {
  const output = renderDashboard([]);
  assert.match(output, /No matching tasks/);
});

test("runReport produces full report", () => {
  const input = "1|Alpha|todo|3|code\n2|Beta|done|5|docs\n";
  const report = runReport(input);
  assert.match(report, /^# Task report/m);
  assert.match(report, /## Summary/);
  assert.match(report, /## Tasks/);
});

test("runReport with query filter", () => {
  const input = "1|Alpha|todo|3|code\n2|Beta|done|5|docs\n";
  const report = runReport(input, { query: "alpha" });
  assert.match(report, /# Task report for "alpha"/);
  assert.match(report, /Total tasks: 1/);
});

test("runReport with sort option", () => {
  const input = "1|Alpha|todo|3|code\n2|Beta|done|5|docs\n";
  const report = runReport(input, { sort: "title" });
  assert.match(report, /Alpha/);
  assert.match(report, /Beta/);
});

test("runReport with status filter", () => {
  const input = "1|Alpha|todo|3|code\n2|Beta|done|5|docs\n";
  const report = runReport(input, { status: "done" });
  assert.match(report, /Total tasks: 1/);
  assert.doesNotMatch(report, /Alpha/);
});
