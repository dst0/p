import * as assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "../src/calculator.ts";

// --- Basic arithmetic ---

test("addition", () => {
  assert.equal(evaluate("1 + 2"), 3);
  assert.equal(evaluate("100 + 200 + 300"), 600);
});

test("subtraction", () => {
  assert.equal(evaluate("5 - 3"), 2);
  assert.equal(evaluate("10 - 4 - 3"), 3);
});

test("multiplication", () => {
  assert.equal(evaluate("3 * 4"), 12);
  assert.equal(evaluate("2 * 3 * 5"), 30);
});

test("division", () => {
  assert.equal(evaluate("12 / 4"), 3);
  assert.equal(evaluate("10 / 2 / 5"), 1);
});

// --- Precedence and associativity ---

test("operator precedence: * before +", () => {
  assert.equal(evaluate("2 + 3 * 4"), 14);
  assert.equal(evaluate("3 * 4 + 2"), 14);
});

test("operator precedence: / before -", () => {
  assert.equal(evaluate("10 - 8 / 2"), 6);
  assert.equal(evaluate("8 / 2 + 3"), 7);
});

test("left associativity of +", () => {
  assert.equal(evaluate("10 - 3 - 2"), 5);
});

test("left associativity of *", () => {
  assert.equal(evaluate("10 / 2 / 5"), 1);
});

// --- Parentheses ---

test("nested parentheses", () => {
  assert.equal(evaluate("((2 + 3) * 4)"), 20);
  assert.equal(evaluate("(1 + (2 * (3 + 4)))"), 15);
});

test("parentheses override precedence", () => {
  assert.equal(evaluate("(2 + 3) * 4"), 20);
  assert.equal(evaluate("2 * (3 + 4)"), 14);
});

// --- Decimal numbers ---

test("decimal literals", () => {
  assert.equal(evaluate("1.5 + 2.5"), 4);
  assert.equal(evaluate("0.1 * 10"), 1);
  assert.equal(evaluate("7.5 / 2.5"), 3);
});

test("single decimal number", () => {
  assert.equal(evaluate("42.0"), 42);
});

// --- Unary minus ---

test("unary minus at start", () => {
  assert.equal(evaluate("-5"), -5);
  assert.equal(evaluate("-2 * 3"), -6);
});

test("unary minus on parenthesized expression", () => {
  assert.equal(evaluate("-(2 + 3)"), -5);
  assert.equal(evaluate("(-1) * -2"), 2);
});

test("consecutive unary minuses", () => {
  assert.equal(evaluate("--5"), 5);
  assert.equal(evaluate("---3"), -3);
});

test("unary minus in expression", () => {
  assert.equal(evaluate("1 + -2 * 3"), -5);
  assert.equal(evaluate("-1 + -2 + -3"), -6);
});

// --- Whitespace ---

test("whitespace is ignored", () => {
  assert.equal(evaluate("  2  +  3  "), 5);
  assert.equal(evaluate("\t4\t*\t5\t"), 20);
});

// --- Error cases ---

test("division by zero throws", () => {
  assert.throws(() => evaluate("5 / 0"), /division by zero/i);
});

test("empty input throws", () => {
  assert.throws(() => evaluate(""), /empty/i);
  assert.throws(() => evaluate("   "), /empty/i);
});

test("incomplete expression throws", () => {
  assert.throws(() => evaluate("2 +"), /unexpected|invalid|expression/i);
  assert.throws(() => evaluate("* 3"), /unexpected|invalid|expression/i);
});

test("missing closing parenthesis throws", () => {
  assert.throws(() => evaluate("(2 + 3"), /missing|parenthesis/i);
});

test("unrecognized characters throw", () => {
  assert.throws(() => evaluate("2 + a"), /unexpected|invalid|expression/i);
  assert.throws(() => evaluate("5%"), /unexpected|invalid|expression/i);
});

test("trailing operator throws", () => {
  assert.throws(() => evaluate("3 * 4 +"), /unexpected|invalid|expression/i);
});
