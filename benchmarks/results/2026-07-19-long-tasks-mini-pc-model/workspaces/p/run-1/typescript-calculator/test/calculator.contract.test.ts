import * as assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "../src/calculator.ts";

test("respects operator precedence", () => {
  assert.equal(evaluate("2 + 3 * 4"), 14);
});

test("supports parentheses and decimals", () => {
  assert.equal(evaluate(" 7.5 / 2.5 "), 3);
  assert.equal(evaluate("(2 + 3) * 4"), 20);
});

test("supports unary minus", () => {
  assert.equal(evaluate("-2 * -3 + 1"), 7);
});

test("rejects division by zero", () => {
  assert.throws(() => evaluate("2 / 0"), /division by zero/i);
});

test("rejects incomplete expressions", () => {
  assert.throws(() => evaluate("2 +"), /unexpected|invalid|expression/i);
});
