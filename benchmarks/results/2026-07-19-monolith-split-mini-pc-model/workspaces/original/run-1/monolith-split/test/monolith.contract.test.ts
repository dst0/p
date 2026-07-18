import * as assert from "node:assert/strict";
import { test } from "node:test";
import { filterTasks, parseTaskFile, runReport, summarizeTasks } from "../src/monolith.ts";

const input = [
  "101|Write release notes|todo|2|docs,release",
  "102|Ship parser refactor|doing|5|code,release",
  "103|Review dashboard|done|3|docs",
  "104|Add regression tests|todo|4|code,test",
].join("\n");

test("public parser and query behavior remains stable", () => {
  const tasks = parseTaskFile(input);
  assert.equal(tasks.length, 4);
  assert.deepEqual(filterTasks(tasks, { tag: "release" }).map((task) => task.id), [101, 102]);
  assert.deepEqual(filterTasks(tasks, { status: "todo" }).map((task) => task.id), [101, 104]);
});

test("public summary behavior remains stable", () => {
  const summary = summarizeTasks(parseTaskFile(input));
  assert.equal(summary.total, 4);
  assert.equal(summary.completed, 1);
  assert.equal(summary.totalEstimate, 14);
  assert.equal(summary.tagCounts.code, 2);
});

test("public report output retains its key sections", () => {
  const report = runReport(input, { sort: "title" });
  assert.match(report, /^# Task report/m);
  assert.match(report, /## Summary/);
  assert.match(report, /## Tasks/);
  assert.match(report, /Ship parser refactor/);
});
