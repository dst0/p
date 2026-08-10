import * as assert from "node:assert/strict";
import { test } from "node:test";
import type { Task, TaskStatus } from "../src/types.js";
import { filterTasks, sortTasks, groupTasksByStatus, selectLargest } from "../src/query.js";

const sampleTasks: Task[] = [
  { id: 1, title: "Alpha", status: "todo", estimate: 3, tags: ["a"] },
  { id: 2, title: "Beta", status: "doing", estimate: 5, tags: ["b"] },
  { id: 3, title: "Gamma", status: "done", estimate: 1, tags: ["a", "c"] },
  { id: 4, title: "Delta", status: "todo", estimate: 4, tags: ["b"] },
];

test("filterTasks by status", () => {
  const result = filterTasks(sampleTasks, { status: "todo" });
  assert.deepEqual(result.map((t) => t.id), [1, 4]);
});

test("filterTasks by tag", () => {
  const result = filterTasks(sampleTasks, { tag: "b" });
  assert.deepEqual(result.map((t) => t.id), [2, 4]);
});

test("filterTasks by query (title match)", () => {
  const result = filterTasks(sampleTasks, { query: "beta" });
  assert.deepEqual(result.map((t) => t.id), [2]);
});

test("filterTasks by query (tag match)", () => {
  const result = filterTasks(sampleTasks, { query: "c" });
  assert.deepEqual(result.map((t) => t.id), [3]);
});

test("filterTasks with combined options", () => {
  const result = filterTasks(sampleTasks, { status: "todo", tag: "a" });
  assert.deepEqual(result.map((t) => t.id), [1]);
});

test("filterTasks with no options returns all tasks", () => {
  const result = filterTasks(sampleTasks);
  assert.equal(result.length, 4);
});

test("sortTasks by id (default)", () => {
  const shuffled = [sampleTasks[2], sampleTasks[0], sampleTasks[3], sampleTasks[1]];
  const result = sortTasks(shuffled);
  assert.deepEqual(result.map((t) => t.id), [1, 2, 3, 4]);
});

test("sortTasks by title", () => {
  const result = sortTasks(sampleTasks, "title");
  assert.deepEqual(result.map((t) => t.title), ["Alpha", "Beta", "Delta", "Gamma"]);
});

test("sortTasks by estimate", () => {
  const result = sortTasks(sampleTasks, "estimate");
  assert.deepEqual(result.map((t) => t.estimate), [1, 3, 4, 5]);
});

test("groupTasksByStatus groups correctly", () => {
  const groups = groupTasksByStatus(sampleTasks);
  assert.deepEqual(groups.todo.map((t) => t.id), [1, 4]);
  assert.deepEqual(groups.doing.map((t) => t.id), [2]);
  assert.deepEqual(groups.done.map((t) => t.id), [3]);
});

test("selectLargest returns top-N by estimate", () => {
  const result = selectLargest(sampleTasks, 2);
  assert.equal(result.length, 2);
  assert.equal(result[0].id, 2); // estimate 5
  assert.equal(result[1].id, 4); // estimate 4
});

test("selectLargest with limit 0 returns all tasks (slice(-0) === full array)", () => {
  const result = selectLargest(sampleTasks, 0);
  // JS: .slice(-0) is equivalent to .slice(0), returning the full sorted array
  assert.equal(result.length, 4);
  // Largest first (sorted by estimate desc): 5, 4, 3, 1
  assert.deepEqual(result.map((t) => t.estimate), [5, 4, 3, 1]);
});

test("selectLargest throws on invalid limit", () => {
  assert.throws(() => selectLargest(sampleTasks, -1), /Invalid limit/);
  assert.throws(() => selectLargest(sampleTasks, 1.5), /Invalid limit/);
});

test("filterTasks returns cloned tasks (no mutation of input)", () => {
  const result = filterTasks(sampleTasks);
  result[0].tags.push("mutated");
  assert.ok(!sampleTasks[0].tags.includes("mutated"));
});

test("sortTasks returns cloned tasks", () => {
  const result = sortTasks(sampleTasks, "title");
  result[0].title = "MUTATED";
  assert.notEqual(sampleTasks[0].title, "MUTATED");
});
