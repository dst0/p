import * as assert from "node:assert/strict";
import { test } from "node:test";
import { filterTasks, sortTasks, groupTasksByStatus, selectLargest } from "../src/query.js";
import { Task } from "../src/types.js";

const tasks: Task[] = [
  { id: 1, title: "Alpha", status: "todo", estimate: 3, tags: ["code"] },
  { id: 2, title: "Beta", status: "doing", estimate: 5, tags: ["docs", "code"] },
  { id: 3, title: "Gamma", status: "done", estimate: 1, tags: ["docs"] },
  { id: 4, title: "Delta", status: "todo", estimate: 4, tags: ["test"] },
];

test("filterTasks by status", () => {
  const result = filterTasks(tasks, { status: "todo" });
  assert.deepEqual(result.map((t) => t.id), [1, 4]);
});

test("filterTasks by tag", () => {
  const result = filterTasks(tasks, { tag: "docs" });
  assert.deepEqual(result.map((t) => t.id), [2, 3]);
});

test("filterTasks by query matches title", () => {
  const result = filterTasks(tasks, { query: "beta" });
  assert.deepEqual(result.map((t) => t.id), [2]);
});

test("filterTasks by query matches tag", () => {
  const result = filterTasks(tasks, { query: "test" });
  assert.deepEqual(result.map((t) => t.id), [4]);
});

test("filterTasks with combined filters", () => {
  const result = filterTasks(tasks, { status: "todo", tag: "code" });
  assert.deepEqual(result.map((t) => t.id), [1]);
});

test("filterTasks returns independent copies", () => {
  const result = filterTasks(tasks, {});
  result[0].title = "MUTATED";
  assert.equal(tasks[0].title, "Alpha");
});

test("sortTasks by id (default)", () => {
  const shuffled = [tasks[2], tasks[0], tasks[3], tasks[1]];
  const result = sortTasks(shuffled);
  assert.deepEqual(result.map((t) => t.id), [1, 2, 3, 4]);
});

test("sortTasks by title", () => {
  const result = sortTasks(tasks, "title");
  assert.deepEqual(result.map((t) => t.title), ["Alpha", "Beta", "Delta", "Gamma"]);
});

test("sortTasks by estimate", () => {
  const result = sortTasks(tasks, "estimate");
  assert.deepEqual(result.map((t) => t.id), [3, 1, 4, 2]);
});

test("sortTasks returns independent copies", () => {
  const result = sortTasks(tasks, "id");
  result[0].title = "MUTATED";
  assert.equal(tasks[0].title, "Alpha");
});

test("groupTasksByStatus groups correctly", () => {
  const groups = groupTasksByStatus(tasks);
  assert.deepEqual(groups.todo.map((t) => t.id), [1, 4]);
  assert.deepEqual(groups.doing.map((t) => t.id), [2]);
  assert.deepEqual(groups.done.map((t) => t.id), [3]);
});

test("selectLargest returns top N by estimate", () => {
  const result = selectLargest(tasks, 2);
  assert.deepEqual(result.map((t) => t.id), [2, 4]);
  assert.equal(result[0].estimate, 5);
  assert.equal(result[1].estimate, 4);
});

test("selectLargest with limit 0 returns all tasks (slice(-0) behavior)", () => {
  const result = selectLargest(tasks, 0);
  assert.equal(result.length, tasks.length);
});

test("selectLargest rejects negative limit", () => {
  assert.throws(() => selectLargest(tasks, -1), { message: "Invalid limit" });
});

test("selectLargest rejects non-integer limit", () => {
  assert.throws(() => selectLargest(tasks, 1.5), { message: "Invalid limit" });
});

test("filterTasks with empty input returns empty", () => {
  assert.deepEqual(filterTasks([]), []);
});

test("sortTasks with empty input returns empty", () => {
  assert.deepEqual(sortTasks([]), []);
});
