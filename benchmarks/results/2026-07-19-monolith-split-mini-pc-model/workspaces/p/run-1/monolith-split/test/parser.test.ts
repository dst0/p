import * as assert from "node:assert/strict";
import { test } from "node:test";
import { parseTaskLine, parseTaskFile, parseStatus, parseTags, normalizeTitleFromString, getTaskStatusOrder, type Task } from "../src/parser.js";

test("parseTaskLine parses a valid pipe-delimited line", () => {
  const task = parseTaskLine("42|Fix the bug|doing|3|code,bug");
  assert.equal(task.id, 42);
  assert.equal(task.title, "Fix the bug");
  assert.equal(task.status, "doing");
  assert.equal(task.estimate, 3);
  assert.deepEqual(task.tags, ["code", "bug"]);
});

test("parseTaskLine handles tags spread across multiple fields", () => {
  const task = parseTaskLine("7|Setup CI|todo|2|ci|infra");
  assert.deepEqual(task.tags, ["ci", "infra"]);
});

test("parseTaskLine rejects malformed lines", () => {
  assert.throws(() => parseTaskLine("1|Title"), { message: "Invalid task line" });
});

test("parseTaskLine rejects invalid id", () => {
  assert.throws(() => parseTaskLine("abc|Title|todo|1|tag"), { message: "Invalid task id" });
  assert.throws(() => parseTaskLine("0|Title|todo|1|tag"), { message: "Invalid task id" });
});

test("parseTaskLine rejects invalid status", () => {
  assert.throws(() => parseTaskLine("1|Title|invalid|1|tag"), { message: "Invalid task status" });
});

test("parseTaskLine rejects invalid estimate", () => {
  assert.throws(() => parseTaskLine("1|Title|todo|bad|tag"), { message: "Invalid estimate" });
  assert.throws(() => parseTaskLine("1|Title|todo|-5|tag"), { message: "Invalid estimate" });
});

test("parseTaskLine normalizes title whitespace", () => {
  const task = parseTaskLine("1|  Multi   Space   Title  |done|1|");
  assert.equal(task.title, "Multi Space Title");
});

test("parseTaskLine handles empty tags", () => {
  const task = parseTaskLine("1|Title|todo|1|");
  assert.deepEqual(task.tags, []);
});

test("parseTaskFile parses multiple lines and skips blanks/comments", () => {
  const input = [
    "# This is a comment",
    "1|Alpha|todo|2|a",
    "",
    "   ",
    "2|Beta|done|3|b",
  ].join("\n");
  const tasks = parseTaskFile(input);
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].id, 1);
  assert.equal(tasks[1].id, 2);
});

test("parseStatus accepts all valid statuses", () => {
  assert.equal(parseStatus("todo"), "todo");
  assert.equal(parseStatus("doing"), "doing");
  assert.equal(parseStatus("done"), "done");
  assert.equal(parseStatus("DONE"), "done");
});

test("parseTags deduplicates and lowercases", () => {
  assert.deepEqual(parseTags("code, Code, CI, ci"), ["code", "ci"]);
  assert.deepEqual(parseTags(""), []);
  assert.deepEqual(parseTags(undefined), []);
});

test("normalizeTitleFromString trims and collapses whitespace", () => {
  assert.equal(normalizeTitleFromString("  hello   world  "), "hello world");
});

test("getTaskStatusOrder returns canonical ordering", () => {
  assert.deepEqual(getTaskStatusOrder(), ["todo", "doing", "done"]);
});
