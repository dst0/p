import * as assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "../src/calculator.ts";

// --- Basic arithmetic ---

test("simple addition", () => {
  assert.equal(evaluate("1 + 1"), 2);
  assert.equal(evaluate("10 + 20 + 30"), 60);
});

test("simple subtraction", () => {
  assert.equal(evaluate("5 - 3"), 2);
  assert.equal(evaluate("10 - 4 - 2"), 4);
});

test("simple multiplication", () => {
  assert.equal(evaluate("3 * 4"), 12);
  assert.equal(evaluate("2 * 3 * 5"), 30);
});

test("simple division", () => {
  assert.equal(evaluate("10 / 2"), 5);
  assert.equal(evaluate("100 / 4 / 5"), 5);
});

// --- Precedence ---

test("multiplication before addition", () => {
  assert.equal(evaluate("2 + 3 * 4"), 14);
  assert.equal(evaluate("3 * 4 + 2"), 14);
});

test("division before subtraction", () => {
  assert.equal(evaluate("10 - 8 / 2"), 6);
});

test("mixed operators respect precedence", () => {
  assert.equal(evaluate("1 + 2 * 3 - 4 / 2"), 5);
});

// --- Parentheses ---

test("parentheses override precedence", () => {
  assert.equal(evaluate("(2 + 3) * 4"), 20);
  assert.equal(evaluate("(10 - 2) / 4"), 2);
});

test("nested parentheses", () => {
  assert.equal(evaluate("((2 + 3) * 4) / 2"), 10);
  assert.equal(evaluate("(1 + (2 * (3 + 4)))"), 15);
});

test("parentheses with unary minus", () => {
  assert.equal(evaluate("(-2 + 3) * 4"), 4);
});

// --- Decimal literals ---

test("decimal numbers", () => {
  assert.equal(evaluate("1.5 + 2.5"), 4);
  assert.equal(evaluate("0.1 * 10"), 1);
});

test("decimal division", () => {
  assert.equal(evaluate("7.5 / 2.5"), 3);
  assert.equal(evaluate("0.001 / 0.01"), 0.1);
});

// --- Unary minus ---

test("unary minus at start", () => {
  assert.equal(evaluate("-5"), -5);
  assert.equal(evaluate("-2 * 3"), -6);
});

test("unary minus in expression", () => {
  assert.equal(evaluate("1 + -2"), -1);
  assert.equal(evaluate("-2 * -3"), 6);
  assert.equal(evaluate("-2 * -3 + 1"), 7);
});

test("double unary minus", () => {
  assert.equal(evaluate("--5"), 5);
  assert.equal(evaluate("-(-3)"), 3);
});

// --- Whitespace handling ---

test("whitespace is ignored", () => {
  assert.equal(evaluate("  2  +  3  "), 5);
  assert.equal(evaluate("\t1 * 2\n"), 2);
});

// --- Single number ---

test("single number expression", () => {
  assert.equal(evaluate("42"), 42);
  assert.equal(evaluate("0"), 0);
});

// --- Error handling ---

test("empty expression throws", () => {
  assert.throws(() => evaluate(""), /empty/i);
});

test("incomplete expression with trailing operator throws", () => {
  assert.throws(() => evaluate("2 +"), /unexpected|invalid/i);
});

test("incomplete expression with leading operator and no operand throws", () => {
  assert.throws(() => evaluate("+"), /unexpected|invalid|end/i);
});

test("incomplete parentheses throws", () => {
  assert.throws(() => evaluate("(2 + 3"), /unexpected|invalid/i);
  assert.throws(() => evaluate("2 + 3)"), /unexpected|invalid/i);
});

test("unknown character throws", () => {
  assert.throws(() => evaluate("2 @ 3"), /unexpected character/i);
  assert.throws(() => evaluate("10 % 3"), /unexpected character/i);
});

test("division by zero throws", () => {
  assert.throws(() => evaluate("5 / 0"), /division by zero/i);
  assert.throws(() => evaluate("10 / (3 - 3)"), /division by zero/i);
});

test("trailing junk after valid expression throws", () => {
  assert.throws(() => evaluate("2 3"), /unexpected/i);
});
