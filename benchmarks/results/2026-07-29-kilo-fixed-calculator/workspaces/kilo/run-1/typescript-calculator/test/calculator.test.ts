import * as assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "../src/calculator.ts";

/* --- basic arithmetic --- */

test("addition", () => {
  assert.equal(evaluate("1 + 2"), 3);
  assert.equal(evaluate("0 + 0"), 0);
});

test("subtraction", () => {
  assert.equal(evaluate("5 - 3"), 2);
  assert.equal(evaluate("1 - 4"), -3);
});

test("multiplication", () => {
  assert.equal(evaluate("3 * 4"), 12);
  assert.equal(evaluate("0 * 99"), 0);
});

test("division", () => {
  assert.equal(evaluate("10 / 2"), 5);
  assert.equal(evaluate("7 / 2"), 3.5);
});

test("operator precedence: multiplication before addition", () => {
  assert.equal(evaluate("1 + 2 * 3"), 7);
  assert.equal(evaluate("2 * 3 + 4 * 5"), 26);
});

test("operator precedence: division before subtraction", () => {
  assert.equal(evaluate("10 - 6 / 2"), 7);
});

test("left associativity", () => {
  assert.equal(evaluate("10 - 5 - 2"), 3);
  assert.equal(evaluate("8 / 4 / 2"), 1);
  assert.equal(evaluate("2 * 3 * 4"), 24);
});

/* --- parentheses --- */

test("nested parentheses", () => {
  assert.equal(evaluate("((2 + 3))"), 5);
  assert.equal(evaluate("(1 + 2) * (3 + 4)"), 21);
  assert.equal(evaluate("((10 - 2) / 4) * 3"), 6);
});

test("parentheses override precedence", () => {
  assert.equal(evaluate("(1 + 2) * 3"), 9);
  assert.equal(evaluate("2 * (3 + 4)"), 14);
});

/* --- unary --- */

test("unary minus on literals", () => {
  assert.equal(evaluate("-5"), -5);
});

test("unary minus on parenthesized expressions", () => {
  assert.equal(evaluate("-(3 + 2)"), -5);
  assert.equal(evaluate("--5"), 5);
});

test("unary minus chained", () => {
  assert.equal(evaluate("---2"), -2);
});

test("unary in complex expression", () => {
  assert.equal(evaluate("-1 + -2 * -3"), 5);
});

/* --- decimals --- */

test("decimal literals", () => {
  assert.equal(evaluate("0.5 + 0.5"), 1);
  assert.equal(evaluate("1.5 * 2"), 3);
});

test("decimal with many digits", () => {
  assert.equal(evaluate("123.456"), 123.456);
});

/* --- whitespace --- */

test("whitespace is ignored", () => {
  assert.equal(evaluate("  1 + 2  "), 3);
  assert.equal(evaluate("\t3*\t4\n"), 12);
});

/* --- errors --- */

test("empty expression throws", () => {
  assert.throws(() => evaluate(""), /empty/i);
  assert.throws(() => evaluate("   "), /empty/i);
});

test("trailing operator throws", () => {
  assert.throws(() => evaluate("3 +"), /unexpected|incomplete|invalid/i);
  assert.throws(() => evaluate("3 *"), /unexpected|incomplete|invalid/i);
});

test("trailing parenthesis throws", () => {
  assert.throws(() => evaluate("(3) +"), /unexpected|incomplete|invalid/i);
});

test("unknown character throws", () => {
  assert.throws(() => evaluate("3 & 2"), /unexpected.*character/i);
});

test("mismatched parentheses throw", () => {
  assert.throws(() => evaluate("(3 + 2"), /unexpected/i);
  assert.throws(() => evaluate("3 + 2)"), /unexpected/i);
});

test("division by zero throws", () => {
  assert.throws(() => evaluate("1 / 0"), /division by zero/i);
  assert.throws(() => evaluate("1 / 0.0"), /division by zero/i);
});

test("only operator throws", () => {
  assert.throws(() => evaluate("+"), /unexpected|incomplete|invalid/i);
  assert.throws(() => evaluate("*"), /unexpected|incomplete|invalid/i);
});
