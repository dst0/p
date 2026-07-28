import * as assert from "node:assert/strict";
import { test } from "node:test";
import type { Task } from "../src/parser.js";
import {
  parseTaskLine,
  parseTaskFile,
  cloneTask,
  normalizeTask,
  normalizeTitle,
  parseStatus,
  parseEstimate,
  parseTags,
  STATUS_ORDER,
} from "../src/parser.js";

test("parseTaskLine parses a well-formed line", () => {
  const task = parseTaskLine("42|Fix bug|doing|3|code,urgent");
  assert.equal(task.id, 42);
  assert.equal(task.title, "Fix bug");
  assert.equal(task.status, "doing");
  assert.equal(task.estimate, 3);
  assert.deepEqual(task.tags, ["code", "urgent"]);
});

test("parseTaskLine throws on too few fields", () => {
  assert.throws(() => parseTaskLine("1|Incomplete"), /Invalid task line/);
});

test("parseTaskLine throws on invalid id", () => {
  assert.throws(() => parseTaskLine("0|Bad|todo|1|tag"), /Invalid task id/);
  assert.throws(() => parseTaskLine("abc|Bad|todo|1|tag"), /Invalid task id/);
});

test("parseTaskLine throws on invalid status", () => {
  assert.throws(() => parseTaskLine("1|Bad|unknown|1|tag"), /Invalid task status/);
});

test("parseTaskLine throws on invalid estimate", () => {
  assert.throws(() => parseTaskLine("1|Bad|todo|-5|tag"), /Invalid estimate/);
});

test("parseTaskFile ignores comments and blank lines", () => {
  const input = [
    "# This is a header",
    "1|Alpha|todo|2|a",
    "",
    "  ",
    "2|Beta|done|1|b",
  ].join("\n");
  const tasks = parseTaskFile(input);
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].id, 1);
  assert.equal(tasks[1].id, 2);
});

test("parseTags normalizes and deduplicates", () => {
  assert.deepEqual(parseTags("A, b, A, B"), ["a", "b"]);
  assert.deepEqual(parseTags(""), []);
  assert.deepEqual(parseTags(undefined), []);
});

test("normalizeTitle collapses whitespace", () => {
  assert.equal(normalizeTitle("Hello   World"), "Hello World");
});

test("parseStatus is case-insensitive", () => {
  assert.equal(parseStatus("TODO"), "todo");
  assert.equal(parseStatus("Doing"), "doing");
  assert.equal(parseStatus("DONE"), "done");
});

test("parseEstimate rejects negative values", () => {
  assert.throws(() => parseEstimate("-1"), /Invalid estimate/);
});

test("cloneTask produces a deep copy of tags", () => {
  const original = { id: 1, title: "T", status: "todo" as const, estimate: 0, tags: ["a"] };
  const clone = cloneTask(original);
  clone.tags.push("b");
  assert.equal(original.tags.length, 1);
  assert.equal(clone.tags.length, 2);
});

test("normalizeTask re-normalizes all fields", () => {
  const raw = { id: 1, title: "  Spaces  ", status: "TODO", estimate: 2, tags: ["UPPER"] };
  const normalized = normalizeTask(raw as Task);
  assert.equal(normalized.title, "Spaces");
  assert.equal(normalized.status, "todo");
  assert.deepEqual(normalized.tags, ["upper"]);
});

test("STATUS_ORDER has all three statuses in order", () => {
  assert.deepEqual(STATUS_ORDER, ["todo", "doing", "done"]);
});
