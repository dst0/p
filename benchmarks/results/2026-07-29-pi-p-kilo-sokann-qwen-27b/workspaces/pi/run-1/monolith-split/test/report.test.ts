import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  summarizeTasks,
  formatSummary,
  serializeTasks,
  renderDashboard,
  runReport,
} from "../src/report.js";
import type { Task, TaskSummary } from "../src/parser.js";

const tasks: Task[] = [
  { id: 1, title: "Alpha", status: "todo", estimate: 2, tags: ["a"] },
  { id: 2, title: "Beta", status: "done", estimate: 3, tags: ["a", "b"] },
  { id: 3, title: "Gamma", status: "todo", estimate: 5, tags: ["c"] },
];

test("summarizeTasks computes correct totals", () => {
  const summary = summarizeTasks(tasks);
  assert.equal(summary.total, 3);
  assert.equal(summary.completed, 1);
  assert.equal(summary.completionRate, 33);
  assert.equal(summary.totalEstimate, 10);
});

test("summarizeTasks computes correct status counts", () => {
  const summary = summarizeTasks(tasks);
  assert.equal(summary.byStatus.todo, 2);
  assert.equal(summary.byStatus.doing, 0);
  assert.equal(summary.byStatus.done, 1);
});

test("summarizeTasks computes correct tag counts", () => {
  const summary = summarizeTasks(tasks);
  assert.equal(summary.tagCounts.a, 2);
  assert.equal(summary.tagCounts.b, 1);
  assert.equal(summary.tagCounts.c, 1);
});

test("summarizeTasks with empty input", () => {
  const summary = summarizeTasks([]);
  assert.equal(summary.total, 0);
  assert.equal(summary.completed, 0);
  assert.equal(summary.completionRate, 0);
  assert.equal(summary.totalEstimate, 0);
});

test("formatSummary contains expected sections", () => {
  const summary = summarizeTasks(tasks);
  const formatted = formatSummary(summary);
  assert.match(formatted, /^## Summary/);
  assert.match(formatted, /Total tasks: 3/);
  assert.match(formatted, /Completed: 1 \(33%\)/);
  assert.match(formatted, /Total estimate: 10/);
  assert.match(formatted, /TODO: 2/);
  assert.match(formatted, /DOING: 0/);
  assert.match(formatted, /DONE: 1/);
});

test("formatSummary with tags", () => {
  const summary = summarizeTasks(tasks);
  const formatted = formatSummary(summary);
  assert.match(formatted, /Tags:/);
  assert.match(formatted, /- a: 2/);
  assert.match(formatted, /- b: 1/);
  assert.match(formatted, /- c: 1/);
});

test("formatSummary with no tags shows 'none'", () => {
  const summary: TaskSummary = {
    total: 1,
    completed: 0,
    completionRate: 0,
    totalEstimate: 1,
    byStatus: { todo: 1, doing: 0, done: 0 },
    tagCounts: {},
  };
  assert.match(formatSummary(summary), /Tags: none/);
});

test("serializeTasks returns valid JSON with a trailing newline", () => {
  const json = serializeTasks(tasks);
  assert.ok(json.endsWith("\n"));
  const parsed = JSON.parse(json.slice(0, -1));
  assert.equal(parsed.length, 3);
});

test("serializeTasks produces independent copies", () => {
  const json = serializeTasks(tasks);
  const parsed = JSON.parse(json);
  parsed[0].title = "Modified";
  assert.equal(tasks[0].title, "Alpha");
});

test("renderDashboard contains expected sections", () => {
  const dashboard = renderDashboard(tasks);
  assert.match(dashboard, /^# Task dashboard/m);
  assert.match(dashboard, /^## Tasks/m);
  assert.match(dashboard, /Dataset checksum:/);
  assert.match(dashboard, /Alpha/);
  assert.ok(dashboard.endsWith("\n"));
});

test("renderDashboard with empty tasks", () => {
  const dashboard = renderDashboard([]);
  assert.match(dashboard, /No matching tasks/);
});

test("runReport produces full report", () => {
  const input = tasks
    .map((t) => `${t.id}|${t.title}|${t.status}|${t.estimate}|${t.tags.join(",")}`)
    .join("\n");
  const report = runReport(input);
  assert.match(report, /^# Task report/m);
  assert.match(report, /## Summary/);
  assert.match(report, /## Tasks/);
  assert.match(report, /Dataset checksum:/);
  assert.ok(report.endsWith("\n"));
});

test("runReport with query filter", () => {
  const input = tasks
    .map((t) => `${t.id}|${t.title}|${t.status}|${t.estimate}|${t.tags.join(",")}`)
    .join("\n");
  const report = runReport(input, { query: "alpha" });
  assert.match(report, /# Task report for "alpha"/);
  assert.match(report, /Total tasks: 1/);
});

test("runReport with status filter", () => {
  const input = tasks
    .map((t) => `${t.id}|${t.title}|${t.status}|${t.estimate}|${t.tags.join(",")}`)
    .join("\n");
  const report = runReport(input, { status: "todo" });
  assert.match(report, /Total tasks: 2/);
});

test("runReport with sort option", () => {
  const input = tasks
    .map((t) => `${t.id}|${t.title}|${t.status}|${t.estimate}|${t.tags.join(",")}`)
    .join("\n");
  const report = runReport(input, { sort: "title" });
  assert.match(report, /Alpha/);
  assert.match(report, /Beta/);
  assert.match(report, /Gamma/);
});
