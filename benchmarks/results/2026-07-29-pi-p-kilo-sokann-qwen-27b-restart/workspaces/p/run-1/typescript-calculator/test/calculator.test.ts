import * as assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate, tokenize, parse } from "../src/calculator.ts";

/* ---- evaluate() happy-path tests ---- */

test("evaluate single number", () => {
  assert.equal(evaluate("42"), 42);
  assert.equal(evaluate("0"), 0);
  assert.equal(evaluate("3.14"), 3.14);
});

test("evaluate basic addition", () => {
  assert.equal(evaluate("1 + 2"), 3);
  assert.equal(evaluate("10 + 20 + 30"), 60);
});

test("evaluate basic subtraction", () => {
  assert.equal(evaluate("5 - 3"), 2);
  assert.equal(evaluate("10 - 2 - 3"), 5);
});

test("evaluate basic multiplication", () => {
  assert.equal(evaluate("3 * 4"), 12);
  assert.equal(evaluate("2 * 3 * 4"), 24);
});

test("evaluate basic division", () => {
  assert.equal(evaluate("10 / 2"), 5);
  assert.equal(evaluate("100 / 4 / 5"), 5);
});

test("evaluate mixed precedence: * before +", () => {
  assert.equal(evaluate("1 + 2 * 3"), 7);
  assert.equal(evaluate("2 * 3 + 4 * 5"), 26);
});

test("evaluate left associativity", () => {
  assert.equal(evaluate("10 - 5 - 2"), 3);
  assert.equal(evaluate("20 / 4 / 2"), 2.5);
});

test("evaluate parentheses override precedence", () => {
  assert.equal(evaluate("(1 + 2) * 3"), 9);
  assert.equal(evaluate("2 * (3 + 4)"), 14);
});

test("evaluate nested parentheses", () => {
  assert.equal(evaluate("(2 + (3 * 4))"), 14);
  assert.equal(evaluate("((2 + 3) * (4 - 1))"), 15);
});

test("evaluate unary minus", () => {
  assert.equal(evaluate("-5"), -5);
  assert.equal(evaluate("--5"), 5);
  assert.equal(evaluate("-(-3)"), 3);
});

test("evaluate unary minus with expressions", () => {
  assert.equal(evaluate("-2 + 3"), 1);
  assert.equal(evaluate("10 - -3"), 13);
  assert.equal(evaluate("-1 * -2 * -3"), -6);
});

test("evaluate decimal arithmetic", () => {
  assert.equal(evaluate("1.5 + 2.5"), 4);
  assert.equal(evaluate("0.1 + 0.2"), 0.30000000000000004);
  assert.equal(evaluate("10.5 / 3.5"), 3);
});

test("evaluate whitespace handling", () => {
  assert.equal(evaluate("  1 + 2  "), 3);
  assert.equal(evaluate("1+2"), 3);
});

test("evaluate complex expression", () => {
  assert.equal(evaluate("2 + 3 * (4 - 1)"), 11);
  assert.equal(evaluate("1 + 2 + 3 * 4 - 5"), 10);
});

/* ---- evaluate() error tests ---- */

test("evaluate rejects empty string", () => {
  assert.throws(() => evaluate(""), /empty/i);
  assert.throws(() => evaluate("   "), /empty/i);
});

test("evaluate rejects unknown characters", () => {
  assert.throws(() => evaluate("2 @ 3"), /unexpected/i);
  assert.throws(() => evaluate("abc"), /unexpected/i);
});

test("evaluate rejects unclosed parenthesis", () => {
  assert.throws(() => evaluate("(2 + 3"), /unexpected|invalid/i);
});

test("evaluate rejects trailing operator", () => {
  assert.throws(() => evaluate("2 +"), /unexpected|invalid/i);
});

test("evaluate rejects bare operator", () => {
  assert.throws(() => evaluate("+"), /invalid/i);
});

test("evaluate rejects bare operator at start", () => {
  assert.throws(() => evaluate("* 3"), /invalid/i);
});

/* ---- tokenize() tests ---- */

test("tokenize produces correct token stream", () => {
  const tokens = tokenize("3.14 * 2");
  assert.deepEqual(tokens, [
    { kind: "number", value: 3.14 },
    { kind: "operator", value: "*" },
    { kind: "number", value: 2 },
  ]);
});

test("tokenize handles parentheses", () => {
  const tokens = tokenize("(1 + 2)");
  assert.deepEqual(tokens, [
    { kind: "lparen" },
    { kind: "number", value: 1 },
    { kind: "operator", value: "+" },
    { kind: "number", value: 2 },
    { kind: "rparen" },
  ]);
});

test("tokenize rejects invalid characters", () => {
  assert.throws(() => tokenize("2 & 3"), /unexpected/i);
});

/* ---- parse() tests ---- */

test("parse handles unary minus on number", () => {
  const tokens = tokenize("-42");
  assert.equal(parse(tokens), -42);
});

test("parse rejects bare closing paren", () => {
  const tokens = tokenize(")");
  assert.throws(() => parse(tokens), /invalid/i);
});
