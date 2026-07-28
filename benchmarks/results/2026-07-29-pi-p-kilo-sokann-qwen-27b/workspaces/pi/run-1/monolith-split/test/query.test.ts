import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  filterTasks,
  sortTasks,
  groupTasksByStatus,
  selectLargest,
} from "../src/query.js";
import type { Task } from "../src/parser.js";

const tasks: Task[] = [
  { id: 1, title: "Alpha", status: "todo", estimate: 2, tags: ["a"] },
  { id: 2, title: "Beta", status: "doing", estimate: 5, tags: ["b", "c"] },
  { id: 3, title: "Gamma", status: "done", estimate: 3, tags: ["a"] },
];

test("filterTasks by status", () => {
  const result = filterTasks(tasks, { status: "todo" });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 1);
});

test("filterTasks by tag", () => {
  const result = filterTasks(tasks, { tag: "a" });
  assert.deepEqual(result.map((t) => t.id), [1, 3]);
});

test("filterTasks by query (title match)", () => {
  const result = filterTasks(tasks, { query: "beta" });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 2);
});

test("filterTasks by query (tag match)", () => {
  const result = filterTasks(tasks, { query: "c" });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 2);
});

test("filterTasks with combined options", () => {
  const result = filterTasks(tasks, { status: "todo", tag: "a" });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 1);
});

test("filterTasks with no options returns all tasks", () => {
  const result = filterTasks(tasks, {});
  assert.equal(result.length, 3);
});

test("filterTasks returns independent copies", () => {
  const result = filterTasks(tasks, {});
  result[0].title = "Modified";
  assert.equal(tasks[0].title, "Alpha");
});

test("sortTasks by id (default)", () => {
  const shuffled = [...tasks].reverse();
  const result = sortTasks(shuffled);
  assert.deepEqual(result.map((t) => t.id), [1, 2, 3]);
});

test("sortTasks by title", () => {
  const result = sortTasks(tasks, "title");
  assert.deepEqual(result.map((t) => t.title), ["Alpha", "Beta", "Gamma"]);
});

test("sortTasks by estimate", () => {
  const result = sortTasks(tasks, "estimate");
  assert.deepEqual(result.map((t) => t.estimate), [2, 3, 5]);
});

test("sortTasks returns independent copies", () => {
  const result = sortTasks(tasks, "title");
  result[0].title = "Modified";
  assert.equal(tasks[0].title, "Alpha");
});

test("groupTasksByStatus partitions correctly", () => {
  const groups = groupTasksByStatus(tasks);
  assert.equal(groups.todo.length, 1);
  assert.equal(groups.doing.length, 1);
  assert.equal(groups.done.length, 1);
  assert.equal(groups.todo[0].id, 1);
  assert.equal(groups.doing[0].id, 2);
  assert.equal(groups.done[0].id, 3);
});

test("selectLargest returns top N by estimate", () => {
  const result = selectLargest(tasks, 2);
  assert.equal(result.length, 2);
  assert.equal(result[0].id, 2); // highest estimate: 5
  assert.equal(result[1].id, 3); // second highest: 3
});

test("selectLargest with limit 0 returns all tasks (slice(-0) behavior)", () => {
  // slice(-0) === slice(0) returns the full array, so limit 0 yields all tasks
  const result = selectLargest(tasks, 0);
  assert.equal(result.length, 3);
  // still sorted descending by estimate
  assert.equal(result[0].estimate, 5);
  assert.equal(result[1].estimate, 3);
  assert.equal(result[2].estimate, 2);
});

test("selectLargest with limit >= total returns all", () => {
  const result = selectLargest(tasks, 10);
  assert.equal(result.length, 3);
  assert.equal(result[0].id, 2);
  assert.equal(result[1].id, 3);
  assert.equal(result[2].id, 1);
});

test("selectLargest throws on invalid limit", () => {
  assert.throws(() => selectLargest(tasks, -1), /Invalid limit/);
  assert.throws(() => selectLargest(tasks, 1.5), /Invalid limit/);
});
