import * as assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "../src/calculator.ts";

// --- Arithmetic correctness ---

test("simple addition", () => {
  assert.equal(evaluate("1 + 2"), 3);
  assert.equal(evaluate("0 + 0"), 0);
});

test("simple subtraction", () => {
  assert.equal(evaluate("5 - 3"), 2);
  assert.equal(evaluate("1 - 4"), -3);
});

test("simple multiplication", () => {
  assert.equal(evaluate("2 * 3"), 6);
  assert.equal(evaluate("0 * 100"), 0);
});

test("simple division", () => {
  assert.equal(evaluate("10 / 2"), 5);
  assert.equal(evaluate("1 / 3"), 1 / 3);
});

test("mixed precedence: multiplication before addition", () => {
  assert.equal(evaluate("1 + 2 * 3 + 4"), 11);
  assert.equal(evaluate("10 - 2 * 3"), 4);
});

test("mixed precedence: division before subtraction", () => {
  assert.equal(evaluate("12 / 3 - 1"), 3);
  assert.equal(evaluate("20 / 4 + 5"), 10);
});

test("left associativity for same-precedence operators", () => {
  assert.equal(evaluate("8 - 3 - 2"), 3); // (8-3)-2
  assert.equal(evaluate("12 / 4 / 2"), 1.5); // (12/4)/2
  assert.equal(evaluate("2 * 3 * 4"), 24);
});

// --- Parentheses ---

test("parentheses override precedence", () => {
  assert.equal(evaluate("(1 + 2) * 3"), 9);
  assert.equal(evaluate("2 * (3 + 4)"), 14);
});

test("nested parentheses", () => {
  assert.equal(evaluate("((2 + 3) * (4 - 1))"), 15);
  assert.equal(evaluate("(1 + (2 * 3))"), 7);
});

test("parentheses with division", () => {
  assert.equal(evaluate("(10 + 5) / 3"), 5);
});

// --- Decimal numbers ---

test("decimal arithmetic", () => {
  assert.equal(evaluate("1.5 + 2.5"), 4);
  assert.equal(evaluate("0.1 + 0.2"), 0.30000000000000004); // JS float
});

test("decimals with precedence", () => {
  assert.equal(evaluate("1.5 * 2 + 3"), 6);
  assert.equal(evaluate("10 / 2.5"), 4);
});

// --- Unary minus ---

test("unary minus at start of expression", () => {
  assert.equal(evaluate("-5"), -5);
  assert.equal(evaluate("-5 + 3"), -2);
});

test("unary minus in the middle", () => {
  assert.equal(evaluate("3 - -2"), 5);
  assert.equal(evaluate("1 + -2 * 3"), -5); // 1 + (-2)*3
});

test("chained unary minus", () => {
  assert.equal(evaluate("--5"), 5);
  assert.equal(evaluate("---3"), -3);
});

test("unary minus with parentheses", () => {
  assert.equal(evaluate("-(2 + 3)"), -5);
  assert.equal(evaluate("-(3 * 2)"), -6);
});

// --- Whitespace handling ---

test("whitespace around tokens", () => {
  assert.equal(evaluate("  2  +  3  "), 5);
  assert.equal(evaluate("1+2"), 3);
  assert.equal(evaluate("(1+2)*3"), 9);
});

// --- Error cases ---

test("empty expression throws", () => {
  assert.throws(() => evaluate(""), /invalid|empty/i);
});

test("whitespace-only expression throws", () => {
  assert.throws(() => evaluate("   "), /invalid|empty/i);
});

test("trailing operator throws", () => {
  assert.throws(() => evaluate("3 +"), /unexpected|invalid/i);
  assert.throws(() => evaluate("5 *"), /unexpected|invalid/i);
});

test("trailing number without operator throws", () => {
  assert.throws(() => evaluate("2 3"), /unexpected/i);
});

test("invalid character throws", () => {
  assert.throws(() => evaluate("2 @ 3"), /unexpected|invalid/i);
});

test("mismatched parentheses throws", () => {
  assert.throws(() => evaluate("(2 + 3"), /unexpected/i);
  assert.throws(() => evaluate("2 + 3)"), /unexpected/i);
});

test("division by zero throws", () => {
  assert.throws(() => evaluate("5 / 0"), /division by zero/i);
  assert.throws(() => evaluate("10 / 0.0"), /division by zero/i);
});

test("operator after closing paren without number throws", () => {
  assert.throws(() => evaluate("(2 + 3) +"), /unexpected|invalid/i);
});

test("bare operator throws", () => {
  assert.throws(() => evaluate("+"), /unexpected/i);
});

// --- Larger expressions ---

test("multi-operation expression", () => {
  assert.equal(evaluate("1 + 2 + 3 + 4 + 5"), 15);
  assert.equal(evaluate("10 - 1 - 1 - 1 - 1 - 1"), 5);
});

test("complex nested expression", () => {
  assert.equal(
    evaluate("((2 + 3) * 4 - 6) / 2 + 1"),
    8, // ((5*4 - 6)/2 + 1) = (14/2 + 1) = 8
  );
});

test("single number", () => {
  assert.equal(evaluate("42"), 42);
  assert.equal(evaluate("0.5"), 0.5);
});
