import * as assert from "node:assert/strict";
import { test } from "node:test";
import type { Task, ReportOptions } from "../src/parser.js";
import { filterTasks, sortTasks } from "../src/query.js";

const tasks: Task[] = [
  { id: 1, title: "Alpha", status: "todo", estimate: 3, tags: ["code"] },
  { id: 2, title: "Beta", status: "doing", estimate: 5, tags: ["docs"] },
  { id: 3, title: "Gamma", status: "done", estimate: 2, tags: ["code", "docs"] },
  { id: 4, title: "Delta", status: "todo", estimate: 4, tags: [] },
];

test("filterTasks by status returns matching tasks", () => {
  const result = filterTasks(tasks, { status: "todo" });
  assert.deepEqual(result.map((t) => t.id), [1, 4]);
});

test("filterTasks by tag returns matching tasks", () => {
  const result = filterTasks(tasks, { tag: "docs" });
  assert.deepEqual(result.map((t) => t.id), [2, 3]);
});

test("filterTasks by query matches title and tags", () => {
  const result = filterTasks(tasks, { query: "beta" });
  assert.deepEqual(result.map((t) => t.id), [2]);
});

test("filterTasks combines multiple filters", () => {
  const result = filterTasks(tasks, { status: "todo", tag: "code" });
  assert.deepEqual(result.map((t) => t.id), [1]);
});

test("filterTasks with no options returns all tasks", () => {
  const result = filterTasks(tasks, {});
  assert.equal(result.length, 4);
});

test("sortTasks by id returns tasks in id order", () => {
  const shuffled = [tasks[2], tasks[0], tasks[3], tasks[1]];
  const result = sortTasks(shuffled, "id");
  assert.deepEqual(result.map((t) => t.id), [1, 2, 3, 4]);
});

test("sortTasks by title returns tasks alphabetically", () => {
  const result = sortTasks(tasks, "title");
  assert.deepEqual(result.map((t) => t.title), ["Alpha", "Beta", "Delta", "Gamma"]);
});

test("sortTasks by estimate orders by estimate then id", () => {
  const result = sortTasks(tasks, "estimate");
  assert.deepEqual(result.map((t) => t.id), [3, 1, 4, 2]);
});

test("sortTasks default sort key is id", () => {
  const shuffled = [tasks[3], tasks[1], tasks[2], tasks[0]];
  const result = sortTasks(shuffled);
  assert.deepEqual(result.map((t) => t.id), [1, 2, 3, 4]);
});
