import * as assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "../src/calculator.ts";

/* ── Basic arithmetic ───────────────────────────────────────────── */

test("single number", () => {
  assert.equal(evaluate("42"), 42);
  assert.equal(evaluate("0"), 0);
});

test("decimal numbers", () => {
  assert.equal(evaluate("3.14"), 3.14);
  assert.equal(evaluate("0.5 + 0.5"), 1);
});

test("addition", () => {
  assert.equal(evaluate("1 + 2"), 3);
  assert.equal(evaluate("1 + 2 + 3"), 6);
});

test("subtraction", () => {
  assert.equal(evaluate("5 - 3"), 2);
  assert.equal(evaluate("10 - 4 - 3"), 3); // left-associative
});

test("multiplication", () => {
  assert.equal(evaluate("3 * 4"), 12);
  assert.equal(evaluate("2 * 3 * 4"), 24); // left-associative
});

test("division", () => {
  assert.equal(evaluate("10 / 2"), 5);
  assert.equal(evaluate("12 / 3 / 2"), 2); // left-associative
});

/* ── Precedence ─────────────────────────────────────────────────── */

test("multiplication before addition", () => {
  assert.equal(evaluate("1 + 2 * 3"), 7);
});

test("addition before division on left", () => {
  assert.equal(evaluate("4 * 3 / 2"), 6);
});

test("mixed precedence chain", () => {
  assert.equal(evaluate("1 + 2 * 3 - 4 * 5"), -9);
});

/* ── Parentheses ────────────────────────────────────────────────── */

test("basic parenthesized expression", () => {
  assert.equal(evaluate("(1 + 2) * 3"), 9);
});

test("nested parentheses", () => {
  assert.equal(evaluate("((2 + 3) * 4) / 2"), 10);
});

test("deeply nested parentheses", () => {
  assert.equal(evaluate("(((3)))"), 3);
});

test("parentheses override precedence", () => {
  assert.equal(evaluate("(1 + 2) * (3 + 4)"), 21);
});

/* ── Unary minus ────────────────────────────────────────────────── */

test("unary minus on literal", () => {
  assert.equal(evaluate("-5"), -5);
});

test("double unary minus", () => {
  assert.equal(evaluate("--5"), 5);
});

test("unary minus with parentheses", () => {
  assert.equal(evaluate("-(1 + 2)"), -3);
});

test("unary minus in expression", () => {
  assert.equal(evaluate("3 - -2"), 5);
});

test("chained unary minus", () => {
  assert.equal(evaluate("---4"), -4);
});

/* ── Whitespace handling ────────────────────────────────────────── */

test("extra whitespace around operators", () => {
  assert.equal(evaluate("  2  +  3  "), 5);
});

test("no whitespace", () => {
  assert.equal(evaluate("2+3"), 5);
});

test("tabs and mixed whitespace", () => {
  assert.equal(evaluate("2\t*\t3"), 6);
});

/* ── Error handling ─────────────────────────────────────────────── */

test("empty input throws", () => {
  assert.throws(() => evaluate(""), /invalid|empty/i);
});

test("whitespace-only input throws", () => {
  assert.throws(() => evaluate("   "), /invalid|empty/i);
});

test("trailing operator throws", () => {
  assert.throws(() => evaluate("3 *"), /unexpected|invalid/i);
});

test("two operators in a row (non-unary) throws", () => {
  assert.throws(() => evaluate("1 + + 2"), /unexpected|invalid/i);
});

test("unmatched parenthesis throws", () => {
  assert.throws(() => evaluate("(2 + 3"), /unexpected|invalid/i);
  assert.throws(() => evaluate("2 + 3)"), /unexpected|invalid/i);
});

test("unknown characters throw", () => {
  assert.throws(() => evaluate("2 % 3"), /unexpected|invalid/i);
});

test("trailing junk after valid expression throws", () => {
  assert.throws(() => evaluate("2 + 3 * abc"), /unexpected|invalid/i);
});

/* ── Edge cases / precision ─────────────────────────────────────── */

test("large numbers", () => {
  assert.equal(evaluate("999999999 + 1"), 1_000_000_000);
});

test("zero in expression", () => {
  assert.equal(evaluate("0 + 0 * 5"), 0);
});

test("fractional division result", () => {
  assert.equal(evaluate("5 / 2"), 2.5);
});
