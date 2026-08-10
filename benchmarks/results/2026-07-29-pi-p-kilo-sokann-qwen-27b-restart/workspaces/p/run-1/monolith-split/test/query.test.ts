import * as assert from "node:assert/strict";
import { test } from "node:test";
import { filterTasks, sortTasks, groupTasksByStatus, selectLargest } from "../src/query.js";
import type { Task, TaskStatus, SortKey } from "../src/types.js";

const fixture: Task[] = [
  { id: 1, title: "Alpha", status: "todo", estimate: 5, tags: ["code"] },
  { id: 2, title: "Beta", status: "doing", estimate: 3, tags: ["docs", "code"] },
  { id: 3, title: "Gamma", status: "done", estimate: 8, tags: ["docs"] },
  { id: 4, title: "Delta", status: "todo", estimate: 2, tags: ["test"] },
];

test("filterTasks filters by status", () => {
  const result = filterTasks(fixture, { status: "todo" });
  assert.deepEqual(result.map((t) => t.id), [1, 4]);
});

test("filterTasks filters by tag", () => {
  const result = filterTasks(fixture, { tag: "code" });
  assert.deepEqual(result.map((t) => t.id), [1, 2]);
});

test("filterTasks filters by query matching title", () => {
  const result = filterTasks(fixture, { query: "beta" });
  assert.deepEqual(result.map((t) => t.id), [2]);
});

test("filterTasks filters by query matching tag", () => {
  const result = filterTasks(fixture, { query: "test" });
  assert.deepEqual(result.map((t) => t.id), [4]);
});

test("filterTasks combines multiple filters", () => {
  const result = filterTasks(fixture, { status: "todo", tag: "code" });
  assert.deepEqual(result.map((t) => t.id), [1]);
});

test("filterTasks returns all when no filters given", () => {
  const result = filterTasks(fixture);
  assert.equal(result.length, 4);
});

test("filterTasks returns independent clones", () => {
  const result = filterTasks(fixture);
  result[0].title = "MUTATED";
  assert.notEqual(fixture[0].title, "MUTATED");
});

test("sortTasks by id (default)", () => {
  const result = sortTasks(fixture);
  assert.deepEqual(result.map((t) => t.id), [1, 2, 3, 4]);
});

test("sortTasks by title", () => {
  const result = sortTasks(fixture, "title");
  assert.deepEqual(result.map((t) => t.title), ["Alpha", "Beta", "Delta", "Gamma"]);
});

test("sortTasks by estimate", () => {
  const result = sortTasks(fixture, "estimate");
  assert.deepEqual(result.map((t) => t.estimate), [2, 3, 5, 8]);
});

test("sortTasks returns independent clones", () => {
  const result = sortTasks(fixture);
  result[0].id = 999;
  assert.notEqual(fixture[0].id, 999);
});

test("groupTasksByStatus groups correctly", () => {
  const groups = groupTasksByStatus(fixture);
  assert.deepEqual(groups.todo.map((t) => t.id), [1, 4]);
  assert.deepEqual(groups.doing.map((t) => t.id), [2]);
  assert.deepEqual(groups.done.map((t) => t.id), [3]);
});

test("groupTasksByStatus returns independent clones", () => {
  const groups = groupTasksByStatus(fixture);
  groups.todo[0].id = 999;
  assert.notEqual(fixture[0].id, 999);
});

test("selectLargest returns top-N by estimate", () => {
  const result = selectLargest(fixture, 2);
  assert.deepEqual(result.map((t) => t.id), [3, 1]);
  assert.deepEqual(result.map((t) => t.estimate), [8, 5]);
});

test("selectLargest with limit 0 returns full sorted array (slice(-0) === slice(0))", () => {
  const result = selectLargest(fixture, 0);
  // slice(-0) is slice(0) in JS, so we get the full sorted-by-estimate array, then reversed
  assert.equal(result.length, 4);
  assert.deepEqual(result.map((t) => t.estimate), [8, 5, 3, 2]);
});

test("selectLargest throws on invalid limit", () => {
  assert.throws(() => selectLargest(fixture, -1), { message: "Invalid limit" });
  assert.throws(() => selectLargest(fixture, 1.5), { message: "Invalid limit" });
});

test("sortTasks with empty input returns empty", () => {
  assert.deepEqual(sortTasks([]), []);
});

test("filterTasks with empty input returns empty", () => {
  assert.deepEqual(filterTasks([]), []);
});
