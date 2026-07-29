import * as assert from "node:assert/strict";
import { test } from "node:test";
import { parseTaskLine, parseTaskFile, cloneTask, normalizeTask, parseId, parseStatus, parseEstimate, parseTags, normalizeTitle } from "../src/parser.js";

test("parseTaskLine parses a valid task line", () => {
  const task = parseTaskLine("5|Fix bug|doing|3|code,bug");
  assert.equal(task.id, 5);
  assert.equal(task.title, "Fix bug");
  assert.equal(task.status, "doing");
  assert.equal(task.estimate, 3);
  assert.deepEqual(task.tags, ["code", "bug"]);
});

test("parseTaskLine throws on missing fields", () => {
  assert.throws(() => parseTaskLine("1|Only two fields"), { message: "Invalid task line" });
});

test("parseTaskLine throws on invalid id", () => {
  assert.throws(() => parseTaskLine("abc|Title|todo|1|tag"), { message: "Invalid task id" });
});

test("parseTaskLine throws on invalid status", () => {
  assert.throws(() => parseTaskLine("1|Title|invalid|1|tag"), { message: "Invalid task status" });
});

test("parseTaskLine throws on negative estimate", () => {
  assert.throws(() => parseTaskLine("1|Title|todo|-5|tag"), { message: "Invalid estimate" });
});

test("parseTaskFile parses multiple lines and skips comments/blanks", () => {
  const input = [
    "# This is a header",
    "1|Task A|todo|2|docs",
    "",
    "2|Task B|done|4|code,release",
  ].join("\n");
  const tasks = parseTaskFile(input);
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].id, 1);
  assert.equal(tasks[1].id, 2);
});

test("parseTaskFile handles Windows line endings", () => {
  const input = "1|Task A|todo|2|docs\r\n2|Task B|done|4|code";
  const tasks = parseTaskFile(input);
  assert.equal(tasks.length, 2);
});

test("parseId validates integer id >= 1", () => {
  assert.equal(parseId("42"), 42);
  assert.throws(() => parseId("0"), { message: "Invalid task id" });
  // Number.parseInt("3.5", 10) === 3, so parseId accepts it
  assert.equal(parseId("3.5"), 3);
});

test("parseStatus accepts todo, doing, done (case-insensitive)", () => {
  assert.equal(parseStatus("todo"), "todo");
  assert.equal(parseStatus("Todo"), "todo");
  assert.equal(parseStatus("DOING"), "doing");
  assert.equal(parseStatus("DONE"), "done");
  assert.throws(() => parseStatus("unknown"), { message: "Invalid task status" });
});

test("parseEstimate accepts non-negative finite numbers", () => {
  assert.equal(parseEstimate("0"), 0);
  assert.equal(parseEstimate("3.5"), 3.5);
  assert.throws(() => parseEstimate("-1"), { message: "Invalid estimate" });
});

test("parseTags deduplicates and lowercases", () => {
  assert.deepEqual(parseTags("Code, code, BUG, Code"), ["code", "bug"]);
  assert.deepEqual(parseTags(""), []);
  assert.deepEqual(parseTags(undefined), []);
});

test("normalizeTitle trims and collapses whitespace", () => {
  assert.equal(normalizeTitle("  Hello   World  "), "Hello World");
  assert.throws(() => normalizeTitle(""), { message: "Missing title" });
});

test("cloneTask produces a deep copy", () => {
  const original = { id: 1, title: "Test", status: "todo" as const, estimate: 2, tags: ["a"] };
  const cloned = cloneTask(original);
  assert.notEqual(cloned.tags, original.tags);
  assert.deepEqual(cloned, original);
});

test("normalizeTask re-normalizes all fields", () => {
  const task = { id: 1, title: "  Spaced  ", status: "TODO" as any, estimate: 3, tags: ["Alpha", "alpha"] };
  const normalized = normalizeTask(task);
  assert.equal(normalized.title, "Spaced");
  assert.equal(normalized.status, "todo");
  assert.deepEqual(normalized.tags, ["alpha"]);
});
