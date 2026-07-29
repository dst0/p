import * as assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeTasks, formatSummary, serializeTasks, renderDashboard, runReport } from "../src/report.js";
import type { Task, TaskStatus } from "../src/types.js";

const fixture: Task[] = [
  { id: 1, title: "Alpha", status: "todo", estimate: 5, tags: ["code"] },
  { id: 2, title: "Beta", status: "doing", estimate: 3, tags: ["docs", "code"] },
  { id: 3, title: "Gamma", status: "done", estimate: 8, tags: ["docs"] },
];

test("summarizeTasks computes correct totals", () => {
  const summary = summarizeTasks(fixture);
  assert.equal(summary.total, 3);
  assert.equal(summary.completed, 1);
  assert.equal(summary.completionRate, 33);
  assert.equal(summary.totalEstimate, 16);
});

test("summarizeTasks computes byStatus counts", () => {
  const summary = summarizeTasks(fixture);
  assert.equal(summary.byStatus.todo, 1);
  assert.equal(summary.byStatus.doing, 1);
  assert.equal(summary.byStatus.done, 1);
});

test("summarizeTasks computes tag counts", () => {
  const summary = summarizeTasks(fixture);
  assert.equal(summary.tagCounts.code, 2);
  assert.equal(summary.tagCounts.docs, 2);
});

test("summarizeTasks handles empty input", () => {
  const summary = summarizeTasks([]);
  assert.equal(summary.total, 0);
  assert.equal(summary.completed, 0);
  assert.equal(summary.completionRate, 0);
  assert.equal(summary.totalEstimate, 0);
});

test("formatSummary produces expected sections", () => {
  const summary = summarizeTasks(fixture);
  const output = formatSummary(summary);
  assert.ok(output.includes("## Summary"));
  assert.ok(output.includes("Total tasks: 3"));
  assert.ok(output.includes("Completed: 1 (33%)"));
  assert.ok(output.includes("Total estimate: 16"));
  assert.ok(output.includes("TODO: 1"));
  assert.ok(output.includes("DOING: 1"));
  assert.ok(output.includes("DONE: 1"));
  assert.ok(output.includes("Tags:"));
});

test("formatSummary shows 'Tags: none' when no tags", () => {
  const summary = summarizeTasks([]);
  const output = formatSummary(summary);
  assert.ok(output.includes("Tags: none"));
});

test("serializeTasks produces valid JSON", () => {
  const output = serializeTasks(fixture);
  const parsed = JSON.parse(output);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].id, 1);
  assert.ok(output.endsWith("\n"));
});

test("serializeTasks returns independent clones", () => {
  const result = JSON.parse(serializeTasks(fixture));
  result[0].id = 999;
  assert.notEqual(fixture[0].id, 999);
});

test("renderDashboard contains expected sections", () => {
  const output = renderDashboard(fixture);
  assert.ok(output.startsWith("# Task dashboard"));
  assert.ok(output.includes("Dataset checksum:"));
  assert.ok(output.includes("## Tasks"));
  assert.ok(output.endsWith("\n"));
});

test("renderDashboard sorts by title", () => {
  const output = renderDashboard(fixture);
  const lines = output.split("\n").filter((l) => l.startsWith("- #"));
  assert.equal(lines[0].includes("Alpha"), true);
  assert.equal(lines[1].includes("Beta"), true);
  assert.equal(lines[2].includes("Gamma"), true);
});

test("renderDashboard with empty tasks shows 'No matching tasks'", () => {
  const output = renderDashboard([]);
  assert.ok(output.includes("No matching tasks"));
});

test("runReport produces full report with all sections", () => {
  const input = [
    "1|Alpha|todo|5|code",
    "2|Beta|done|3|docs",
  ].join("\n");
  const report = runReport(input);
  assert.ok(report.includes("# Task report"));
  assert.ok(report.includes("## Summary"));
  assert.ok(report.includes("## Tasks"));
  assert.ok(report.includes("Dataset checksum:"));
  assert.ok(report.endsWith("\n"));
});

test("runReport with query filter", () => {
  const input = [
    "1|Alpha|todo|5|code",
    "2|Beta|done|3|docs",
  ].join("\n");
  const report = runReport(input, { query: "beta" });
  assert.ok(report.includes('for "beta"'));
  assert.ok(!report.includes("Alpha"));
});

test("runReport with status filter", () => {
  const input = [
    "1|Alpha|todo|5|code",
    "2|Beta|done|3|docs",
  ].join("\n");
  const report = runReport(input, { status: "done" });
  assert.ok(!report.includes("Alpha"));
  assert.ok(report.includes("Beta"));
});

test("runReport with sort option", () => {
  const input = [
    "2|Beta|todo|5|code",
    "1|Alpha|done|3|docs",
  ].join("\n");
  const report = runReport(input, { sort: "title" });
  const taskLines = report.split("\n").filter((l) => l.startsWith("- #"));
  assert.ok(taskLines[0].includes("Alpha"));
  assert.ok(taskLines[1].includes("Beta"));
});
