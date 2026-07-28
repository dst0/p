import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseTaskLine,
  parseTaskFile,
  parseId,
  parseStatus,
  parseEstimate,
  parseTags,
  normalizeTitle,
  cloneTask,
  normalizeTask,
} from "../src/parser.js";

test("parseTaskLine parses a valid line", () => {
  const task = parseTaskLine("1|Build feature|todo|3|code,feature");
  assert.equal(task.id, 1);
  assert.equal(task.title, "Build feature");
  assert.equal(task.status, "todo");
  assert.equal(task.estimate, 3);
  assert.deepEqual(task.tags, ["code", "feature"]);
});

test("parseTaskLine throws on invalid line", () => {
  assert.throws(() => parseTaskLine("bad"), { message: /Invalid task line/ });
});

test("parseTaskFile parses multiple lines and skips comments and blanks", () => {
  const input = [
    "# header comment",
    "1|Task A|todo|2|a",
    "",
    "2|Task B|done|4|b",
    "   ",
  ].join("\n");
  const tasks = parseTaskFile(input);
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].id, 1);
  assert.equal(tasks[1].id, 2);
});

test("parseId rejects invalid values", () => {
  assert.throws(() => parseId(undefined), { message: /Missing id/ });
  assert.throws(() => parseId("0"), { message: /Invalid task id/ });
  assert.throws(() => parseId("abc"), { message: /Invalid task id/ });
});

test("parseStatus rejects unknown status", () => {
  assert.throws(() => parseStatus("unknown"), { message: /Invalid task status/ });
});

test("parseEstimate rejects negative and non-numeric", () => {
  assert.throws(() => parseEstimate("-1"), { message: /Invalid estimate/ });
  assert.throws(() => parseEstimate("abc"), { message: /Invalid estimate/ });
});

test("parseTags handles empty and duplicate tags", () => {
  assert.deepEqual(parseTags(undefined), []);
  assert.deepEqual(parseTags("  "), []);
  assert.deepEqual(parseTags("a, b, a"), ["a", "b"]);
});

test("normalizeTitle trims and collapses whitespace", () => {
  assert.equal(normalizeTitle("  Hello   World  "), "Hello World");
});

test("cloneTask produces an independent copy", () => {
  const original = { id: 1, title: "T", status: "todo" as const, estimate: 2, tags: ["a"] };
  const copy = cloneTask(original);
  copy.tags.push("b");
  assert.deepEqual(original.tags, ["a"]);
});

test("normalizeTask normalizes all fields", () => {
  const task = { id: 1, title: "  Hello  ", status: "todo" as const, estimate: 3, tags: ["a", "b"] };
  const normalized = normalizeTask(task);
  assert.equal(normalized.title, "Hello");
  assert.equal(normalized.status, "todo");
  assert.deepEqual(normalized.tags, ["a", "b"]);
});
