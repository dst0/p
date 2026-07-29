import * as assert from "node:assert/strict";
import { test } from "node:test";
import { parseTaskLine, parseTaskFile, normalizeTask, cloneTask, normalizeTitle, parseStatus } from "../src/parser.js";

test("parseTaskLine parses a valid pipe-delimited line", () => {
  const task = parseTaskLine("1|Fix bug|todo|3|code,bug");
  assert.equal(task.id, 1);
  assert.equal(task.title, "Fix bug");
  assert.equal(task.status, "todo");
  assert.equal(task.estimate, 3);
  assert.deepEqual(task.tags, ["code", "bug"]);
});

test("parseTaskLine rejects line with fewer than 5 fields", () => {
  assert.throws(() => parseTaskLine("1|Fix|todo"), { message: "Invalid task line" });
});

test("parseTaskLine rejects invalid id", () => {
  assert.throws(() => parseTaskLine("0|Fix bug|todo|3|code"), { message: "Invalid task id" });
  assert.throws(() => parseTaskLine("abc|Fix bug|todo|3|code"), { message: "Invalid task id" });
});

test("parseTaskLine rejects invalid status", () => {
  assert.throws(() => parseTaskLine("1|Fix bug|invalid|3|code"), { message: "Invalid task status" });
});

test("parseTaskLine rejects invalid estimate", () => {
  assert.throws(() => parseTaskLine("1|Fix bug|todo|-1|code"), { message: "Invalid estimate" });
  assert.throws(() => parseTaskLine("1|Fix bug|todo|abc|code"), { message: "Invalid estimate" });
});

test("parseTaskLine handles empty tags", () => {
  const task = parseTaskLine("1|Fix bug|todo|3|");
  assert.deepEqual(task.tags, []);
});

test("parseTaskFile parses multiple lines and skips comments/blanks", () => {
  const input = [
    "# header comment",
    "1|Task A|todo|2|docs",
    "",
    "2|Task B|done|1|code",
  ].join("\n");
  const tasks = parseTaskFile(input);
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].id, 1);
  assert.equal(tasks[1].id, 2);
});

test("parseStatus is case-insensitive", () => {
  assert.equal(parseStatus("TODO"), "todo");
  assert.equal(parseStatus("Doing"), "doing");
  assert.equal(parseStatus("DONE"), "done");
});

test("normalizeTitle collapses whitespace", () => {
  assert.equal(normalizeTitle("  Hello   World  "), "Hello World");
});

test("normalizeTask re-normalizes a task", () => {
  const task = normalizeTask({ id: 1, title: "  Spaced  Title  ", status: "todo" as const, estimate: 5, tags: [" Code ", ""] });
  assert.equal(task.title, "Spaced Title");
  assert.equal(task.status, "todo");
  assert.deepEqual(task.tags, ["code"]);
});

test("cloneTask produces a deep copy", () => {
  const original = { id: 1, title: "Test", status: "todo" as const, estimate: 2, tags: ["a"] };
  const copy = cloneTask(original);
  assert.notEqual(copy, original);
  assert.notEqual(copy.tags, original.tags);
  copy.tags.push("b");
  assert.deepEqual(original.tags, ["a"]);
});

test("parseTaskFile handles Windows line endings", () => {
  const input = "1|Task A|todo|2|docs\r\n2|Task B|done|1|code\r\n";
  const tasks = parseTaskFile(input);
  assert.equal(tasks.length, 2);
});
