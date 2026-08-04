import * as assert from "node:assert/strict";
import { test } from "node:test";
import { parseTaskLine, parseTaskFile } from "../src/parser.js";

test("parseTaskLine parses a well-formed line", () => {
  const task = parseTaskLine("42|Fix the bug|todo|3|bug,urgent");
  assert.equal(task.id, 42);
  assert.equal(task.title, "Fix the bug");
  assert.equal(task.status, "todo");
  assert.equal(task.estimate, 3);
  assert.deepEqual(task.tags, ["bug", "urgent"]);
});

test("parseTaskLine normalizes title whitespace", () => {
  const task = parseTaskLine("1|  lots   of   spaces  |done|1|");
  assert.equal(task.title, "lots of spaces");
});

test("parseTaskLine with no tags returns empty array", () => {
  const task = parseTaskLine("1|Title|doing|2|");
  assert.deepEqual(task.tags, []);
});

test("parseTaskLine with pipe in tags joins them as one tag", () => {
  const task = parseTaskLine("1|Title|doing|2|a|b");
  // Fields 4+ are joined with | then split by comma, so "a|b" is a single tag
  assert.deepEqual(task.tags, ["a|b"]);
});

test("parseTaskLine rejects missing fields", () => {
  assert.throws(() => parseTaskLine("1"), /Invalid task line/);
  assert.throws(() => parseTaskLine("abc|Title|todo|1|"), /Invalid task id/);
  assert.throws(() => parseTaskLine("1||todo|1|"), /Missing title/);
  assert.throws(() => parseTaskLine("1|Title|bogus|1|"), /Invalid task status/);
  assert.throws(() => parseTaskLine("1|Title|todo|-5|"), /Invalid estimate/);
});

test("parseTaskFile parses multiple lines and skips comments/blanks", () => {
  const input = [
    "# header comment",
    "",
    "10|Alpha|todo|1|a",
    "20|Beta|done|2|b",
    "  ",
  ].join("\n");
  const tasks = parseTaskFile(input);
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].id, 10);
  assert.equal(tasks[1].id, 20);
});

test("parseTaskFile handles Windows line endings", () => {
  const input = "1|A|todo|1|\r\n2|B|done|2|".replace(/\r\n/g, "\r\n");
  const tasks = parseTaskFile(input);
  assert.equal(tasks.length, 2);
});
