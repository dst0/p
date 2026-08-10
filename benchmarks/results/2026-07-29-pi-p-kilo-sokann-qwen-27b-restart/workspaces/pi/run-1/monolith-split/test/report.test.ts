import * as assert from "node:assert/strict";
import { test } from "node:test";
import type { Task, TaskSummary } from "../src/types.js";
import { summarizeTasks, formatSummary, formatTaskTable, serializeTasks, renderDashboard, runReport } from "../src/report.js";

const sampleTasks: Task[] = [
  { id: 1, title: "Alpha", status: "todo", estimate: 3, tags: ["a"] },
  { id: 2, title: "Beta", status: "doing", estimate: 5, tags: ["b"] },
  { id: 3, title: "Gamma", status: "done", estimate: 1, tags: ["a", "c"] },
];

test("summarizeTasks computes correct totals", () => {
  const summary = summarizeTasks(sampleTasks);
  assert.equal(summary.total, 3);
  assert.equal(summary.completed, 1);
  assert.equal(summary.completionRate, 33);
  assert.equal(summary.totalEstimate, 9);
});

test("summarizeTasks computes byStatus correctly", () => {
  const summary = summarizeTasks(sampleTasks);
  assert.equal(summary.byStatus.todo, 1);
  assert.equal(summary.byStatus.doing, 1);
  assert.equal(summary.byStatus.done, 1);
});

test("summarizeTasks computes tagCounts correctly", () => {
  const summary = summarizeTasks(sampleTasks);
  assert.equal(summary.tagCounts.a, 2);
  assert.equal(summary.tagCounts.b, 1);
  assert.equal(summary.tagCounts.c, 1);
});

test("summarizeTasks with empty tasks", () => {
  const summary = summarizeTasks([]);
  assert.equal(summary.total, 0);
  assert.equal(summary.completionRate, 0);
  assert.equal(summary.totalEstimate, 0);
});

test("formatSummary produces expected sections", () => {
  const summary = summarizeTasks(sampleTasks);
  const formatted = formatSummary(summary);
  assert.match(formatted, /^## Summary/m);
  assert.match(formatted, /Total tasks: 3/);
  assert.match(formatted, /Completed: 1 \(33%\)/);
  assert.match(formatted, /Total estimate: 9/);
  assert.match(formatted, /TODO: 1/);
  assert.match(formatted, /DOING: 1/);
  assert.match(formatted, /DONE: 1/);
  assert.match(formatted, /- a: 2/);
  assert.match(formatted, /- b: 1/);
});

test("formatSummary with no tags shows 'Tags: none'", () => {
  const emptySummary: TaskSummary = {
    total: 0,
    completed: 0,
    completionRate: 0,
    totalEstimate: 0,
    byStatus: { todo: 0, doing: 0, done: 0 },
    tagCounts: {},
  };
  const formatted = formatSummary(emptySummary);
  assert.match(formatted, /Tags: none/);
});

test("formatTaskTable with tasks", () => {
  const table = formatTaskTable(sampleTasks);
  assert.match(table, /^## Tasks/m);
  assert.match(table, /- #1 Alpha \(todo, 3\) \[a\]/);
});

test("formatTaskTable with no tasks", () => {
  const table = formatTaskTable([]);
  assert.equal(table, "## Tasks\nNo matching tasks.");
});

test("serializeTasks produces valid JSON", () => {
  const json = serializeTasks(sampleTasks);
  const parsed = JSON.parse(json);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].id, 1);
});

test("serializeTasks returns cloned data", () => {
  const json = serializeTasks(sampleTasks);
  const parsed = JSON.parse(json);
  parsed[0].tags.push("mutated");
  assert.ok(!sampleTasks[0].tags.includes("mutated"));
});

test("renderDashboard has expected structure", () => {
  const dashboard = renderDashboard(sampleTasks);
  assert.match(dashboard, /^# Task dashboard/);
  assert.match(dashboard, /Dataset checksum: \d+/);
  assert.match(dashboard, /## Tasks/);
});

test("renderDashboard sorts by title", () => {
  const dashboard = renderDashboard(sampleTasks);
  const alphaIndex = dashboard.indexOf("Alpha");
  const betaIndex = dashboard.indexOf("Beta");
  const gammaIndex = dashboard.indexOf("Gamma");
  assert.ok(alphaIndex < betaIndex, "Alpha should appear before Beta");
  assert.ok(betaIndex < gammaIndex, "Beta should appear before Gamma");
});

test("runReport produces full report", () => {
  const input = sampleTasks.map((t) =>
    `${t.id}|${t.title}|${t.status}|${t.estimate}|${t.tags.join(",")}`
  ).join("\n");

  const report = runReport(input);
  assert.match(report, /^# Task report$/m);
  assert.match(report, /## Summary/);
  assert.match(report, /## Tasks/);
  assert.match(report, /Dataset checksum: \d+/);
});

test("runReport with query option", () => {
  const input = sampleTasks.map((t) =>
    `${t.id}|${t.title}|${t.status}|${t.estimate}|${t.tags.join(",")}`
  ).join("\n");

  const report = runReport(input, { query: "beta" });
  assert.match(report, /^# Task report for "beta"$/m);
});

test("runReport with sort option", () => {
  const input = sampleTasks.map((t) =>
    `${t.id}|${t.title}|${t.status}|${t.estimate}|${t.tags.join(",")}`
  ).join("\n");

  const report = runReport(input, { sort: "title" });
  // Tasks should be in title order: Alpha, Beta, Gamma
  const alphaIdx = report.indexOf("Alpha");
  const betaIdx = report.indexOf("Beta");
  assert.ok(alphaIdx < betaIdx, "Alpha should appear before Beta when sorted by title");
});
