import * as assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "../src/calculator.ts";

// --- Basic arithmetic ---

test("simple addition", () => {
  assert.equal(evaluate("1 + 2"), 3);
  assert.equal(evaluate("0 + 0"), 0);
  assert.equal(evaluate("100 + 200"), 300);
});

test("simple subtraction", () => {
  assert.equal(evaluate("5 - 3"), 2);
  assert.equal(evaluate("1 - 4"), -3);
});

test("simple multiplication", () => {
  assert.equal(evaluate("3 * 4"), 12);
  assert.equal(evaluate("0 * 100"), 0);
});

test("simple division", () => {
  assert.equal(evaluate("10 / 2"), 5);
  assert.equal(evaluate("7 / 2"), 3.5);
});

// --- Precedence ---

test("multiplication before addition", () => {
  assert.equal(evaluate("1 + 2 * 3"), 7);
});

test("multiplication before subtraction", () => {
  assert.equal(evaluate("10 - 2 * 3"), 4);
});

test("division before addition", () => {
  assert.equal(evaluate("6 / 2 + 3"), 6);
});

test("left associativity of addition", () => {
  assert.equal(evaluate("1 + 2 + 3"), 6);
});

test("left associativity of subtraction", () => {
  assert.equal(evaluate("10 - 3 - 2"), 5);
});

test("left associativity of multiplication", () => {
  assert.equal(evaluate("2 * 3 * 4"), 24);
});

test("mixed precedence chain", () => {
  assert.equal(evaluate("1 + 2 * 3 - 4 / 2"), 5);
});

// --- Parentheses ---

test("parenthesized addition", () => {
  assert.equal(evaluate("(1 + 2) * 3"), 9);
});

test("nested parentheses", () => {
  assert.equal(evaluate("((2 + 3) * 4)"), 20);
  assert.equal(evaluate("(1 + (2 * (3 + 4)))"), 15);
});

test("parentheses with subtraction", () => {
  assert.equal(evaluate("(5 - 3) * (2 + 1)"), 6);
});

// --- Decimal numbers ---

test("decimal literals", () => {
  assert.equal(evaluate("0.5 + 0.5"), 1);
  assert.equal(evaluate("1.5 * 2"), 3);
  assert.equal(evaluate("10.0 / 4.0"), 2.5);
});

// --- Unary minus ---

test("unary minus at start", () => {
  assert.equal(evaluate("-5"), -5);
  assert.equal(evaluate("-2 + 3"), 1);
});

test("unary minus before parenthesized expression", () => {
  assert.equal(evaluate("-(2 + 3)"), -5);
});

test("chained unary minus", () => {
  assert.equal(evaluate("--5"), 5);
  assert.equal(evaluate("---2"), -2);
});

test("unary minus in multiplication", () => {
  assert.equal(evaluate("-3 * 4"), -12);
  assert.equal(evaluate("3 * -4"), -12);
  assert.equal(evaluate("-2 * -3"), 6);
});

// --- Whitespace handling ---

test("whitespace is ignored", () => {
  assert.equal(evaluate(" 1 + 2 "), 3);
  assert.equal(evaluate("  1  +  2  "), 3);
});

test("empty input throws", () => {
  assert.throws(() => evaluate(""), /unexpected|invalid|expression|end/i);
});

// --- Error handling ---

test("division by zero throws", () => {
  assert.throws(() => evaluate("5 / 0"), { message: "Division by zero" });
});

test("incomplete expression with trailing operator throws", () => {
  assert.throws(() => evaluate("3 +"), /unexpected|invalid|expression/i);
});

test("incomplete expression with trailing multiplication", () => {
  assert.throws(() => evaluate("2 *"), /unexpected|invalid|expression/i);
});

test("missing closing parenthesis throws", () => {
  assert.throws(() => evaluate("(2 + 3"), /unexpected|missing/i);
});

test("unexpected closing parenthesis throws", () => {
  assert.throws(() => evaluate("2 + )"), /unexpected|invalid|error/i);
});

test("invalid characters throw", () => {
  assert.throws(() => evaluate("2 ^ 3"), /invalid|invalid character/i);
  assert.throws(() => evaluate("abc"), /invalid/i);
});

// --- Edge cases ---

test("single number", () => {
  assert.equal(evaluate("42"), 42);
  assert.equal(evaluate("0"), 0);
});

test("negative result from subtraction", () => {
  assert.equal(evaluate("1 - 10"), -9);
});

test("complex expression", () => {
  assert.equal(evaluate("2 + 3 * (4 - 1)"), 11);
});

test("large expression", () => {
  assert.equal(evaluate("1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10"), 55);
});
