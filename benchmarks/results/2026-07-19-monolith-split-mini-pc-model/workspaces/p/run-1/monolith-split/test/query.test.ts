import * as assert from "node:assert/strict";
import { test } from "node:test";
import { filterTasks, sortTasks, groupTasksByStatus, selectLargest, type Task, type ReportOptions } from "../src/monolith.js";

const tasks: Task[] = [
  { id: 1, title: "Alpha", status: "todo", estimate: 3, tags: ["a"] },
  { id: 2, title: "Beta", status: "doing", estimate: 5, tags: ["b"] },
  { id: 3, title: "Gamma", status: "done", estimate: 1, tags: ["a", "b"] },
  { id: 4, title: "Delta", status: "todo", estimate: 2, tags: [] },
];

test("filterTasks by status", () => {
  const filtered = filterTasks(tasks, { status: "todo" });
  assert.deepEqual(filtered.map((t) => t.id), [1, 4]);
});

test("filterTasks by tag", () => {
  const filtered = filterTasks(tasks, { tag: "a" });
  assert.deepEqual(filtered.map((t) => t.id), [1, 3]);
});

test("filterTasks by query matching title", () => {
  const filtered = filterTasks(tasks, { query: "beta" });
  assert.deepEqual(filtered.map((t) => t.id), [2]);
});

test("filterTasks by query matching tag", () => {
  const filtered = filterTasks(tasks, { query: "b" });
  assert.deepEqual(filtered.map((t) => t.id), [2, 3]);
});

test("filterTasks with combined options", () => {
  const filtered = filterTasks(tasks, { status: "todo", tag: "a" });
  assert.deepEqual(filtered.map((t) => t.id), [1]);
});

test("filterTasks returns copies (deep clone)", () => {
  const filtered = filterTasks(tasks, {});
  filtered[0].tags.push("mutated");
  assert.ok(!tasks[0].tags.includes("mutated"));
});

test("filterTasks with no options returns all tasks", () => {
  const filtered = filterTasks(tasks);
  assert.equal(filtered.length, 4);
});

test("sortTasks by id (default)", () => {
  const shuffled = [tasks[2], tasks[0], tasks[3], tasks[1]];
  const sorted = sortTasks(shuffled);
  assert.deepEqual(sorted.map((t) => t.id), [1, 2, 3, 4]);
});

test("sortTasks by title", () => {
  const sorted = sortTasks(tasks, "title");
  assert.deepEqual(sorted.map((t) => t.title), ["Alpha", "Beta", "Delta", "Gamma"]);
});

test("sortTasks by estimate", () => {
  const sorted = sortTasks(tasks, "estimate");
  assert.deepEqual(sorted.map((t) => t.id), [3, 4, 1, 2]);
});

test("sortTasks returns copies", () => {
  const sorted = sortTasks(tasks);
  sorted[0].title = "mutated";
  assert.ok(tasks[0].title !== "mutated");
});

test("groupTasksByStatus groups correctly", () => {
  const groups = groupTasksByStatus(tasks);
  assert.deepEqual(groups.todo.map((t) => t.id), [1, 4]);
  assert.deepEqual(groups.doing.map((t) => t.id), [2]);
  assert.deepEqual(groups.done.map((t) => t.id), [3]);
});

test("selectLargest returns top N by estimate", () => {
  const largest = selectLargest(tasks, 2);
  assert.deepEqual(largest.map((t) => t.id), [2, 1]);
});

test("selectLargest with limit 0 returns empty", () => {
  assert.deepEqual(selectLargest(tasks, 0), []);
});

test("selectLargest rejects negative limit", () => {
  assert.throws(() => selectLargest(tasks, -1), { message: "Invalid limit" });
});

test("selectLargest rejects non-integer limit", () => {
  assert.throws(() => selectLargest(tasks, 1.5), { message: "Invalid limit" });
});
