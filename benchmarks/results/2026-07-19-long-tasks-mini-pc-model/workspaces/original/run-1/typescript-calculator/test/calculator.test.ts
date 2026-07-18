import * as assert from "node:assert/strict";
import { test, describe } from "node:test";
import { evaluate } from "../src/calculator.ts";

describe("basic arithmetic", () => {
  test("single number", () => {
    assert.equal(evaluate("42"), 42);
  });

  test("addition", () => {
    assert.equal(evaluate("1 + 2 + 3"), 6);
  });

  test("subtraction", () => {
    assert.equal(evaluate("10 - 4 - 2"), 4);
  });

  test("multiplication", () => {
    assert.equal(evaluate("2 * 3 * 4"), 24);
  });

  test("division", () => {
    assert.equal(evaluate("100 / 5 / 2"), 10);
  });

  test("mixed operators respect precedence", () => {
    assert.equal(evaluate("1 + 2 * 3 - 4 / 2"), 5); // 1 + 6 - 2 = 5
  });
});

describe("parentheses", () => {
  test("nested parentheses", () => {
    assert.equal(evaluate("((2 + 3))"), 5);
    assert.equal(evaluate("((1 + 2) * (3 + 4))"), 21);
  });

  test("deeply nested", () => {
    assert.equal(evaluate("((((5))))"), 5);
  });

  test("parentheses override precedence", () => {
    assert.equal(evaluate("(1 + 2) * 3"), 9);
    assert.equal(evaluate("1 + (2 * 3)"), 7);
  });

  test("complex nested expression", () => {
    assert.equal(evaluate("2 * (3 + (4 * 5))"), 46); // 2 * (3 + 20) = 46
  });
});

describe("decimal literals", () => {
  test("simple decimal", () => {
    assert.equal(evaluate("3.14"), 3.14);
  });

  test("decimal arithmetic", () => {
    assert.equal(evaluate("1.5 + 2.5"), 4);
  });

  test("decimal multiplication", () => {
    assert.equal(evaluate("0.1 * 10"), 1);
  });

  test("zero", () => {
    assert.equal(evaluate("0"), 0);
    assert.equal(evaluate("0 + 5"), 5);
    assert.equal(evaluate("0 * 5"), 0);
  });
});

describe("unary minus", () => {
  test("leading unary minus", () => {
    assert.equal(evaluate("-5"), -5);
  });

  test("unary minus with multiplication", () => {
    assert.equal(evaluate("-3 * 4"), -12);
  });

  test("chained unary minus", () => {
    assert.equal(evaluate("--5"), 5);
    assert.equal(evaluate("---7"), -7);
  });

  test("unary minus after parenthesis", () => {
    assert.equal(evaluate("(2 + 3) * -4"), -20);
  });

  test("unary minus with parentheses", () => {
    assert.equal(evaluate("-(2 + 3)"), -5);
    assert.equal(evaluate("-(3 - 1) * 2"), -4);
  });

  test("unary minus on decimal", () => {
    assert.equal(evaluate("-3.5 + 1.5"), -2);
  });
});

describe("whitespace handling", () => {
  test("extra spaces are ignored", () => {
    assert.equal(evaluate("  1  +  2  "), 3);
  });

  test("no spaces", () => {
    assert.equal(evaluate("1+2*3"), 7);
  });

  test("spaces around parentheses", () => {
    assert.equal(evaluate("( 2 + 3 ) * 4"), 20);
  });
});

describe("error handling", () => {
  test("empty string throws", () => {
    assert.throws(() => evaluate(""), /end of expression|empty/i);
  });

  test("only whitespace throws", () => {
    assert.throws(() => evaluate("   "), /end of expression|empty/i);
  });

  test("trailing operator throws", () => {
    assert.throws(() => evaluate("3 +"), /unexpected|invalid|expression/i);
  });

  test("trailing division operator throws", () => {
    assert.throws(() => evaluate("3 /"), /unexpected|invalid|expression/i);
  });

  test("trailing multiplication operator throws", () => {
    assert.throws(() => evaluate("3 *"), /unexpected|invalid|expression/i);
  });

  test("missing operand after minus", () => {
    assert.throws(() => evaluate("3 - "), /unexpected|invalid|expression/i);
  });

  test("unmatched opening parenthesis", () => {
    assert.throws(() => evaluate("(2 + 3"), /expected.*\)/i);
  });

  test("unmatched closing parenthesis", () => {
    assert.throws(() => evaluate("2 + 3)"), /unexpected|invalid/i);
  });

  test("invalid characters", () => {
    assert.throws(() => evaluate("2 + 3 * abc"), /unexpected.*character/i);
  });

  test("invalid characters in expression", () => {
    assert.throws(() => evaluate("2 @ 3"), /unexpected.*character/i);
  });

  test("division by zero with decimals", () => {
    assert.throws(() => evaluate("5.5 / 0"), /division by zero/i);
  });

  test("division by zero in nested expression", () => {
    assert.throws(() => evaluate("10 / (3 - 3)"), /division by zero/i);
  });
});

describe("edge cases", () => {
  test("large number", () => {
    assert.equal(evaluate("999999999"), 999999999);
  });

  test("many operations in sequence", () => {
    assert.equal(evaluate("1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10"), 55);
  });

  test("subtraction resulting in negative", () => {
    assert.equal(evaluate("1 - 2"), -1);
  });

  test("division resulting in decimal", () => {
    assert.equal(evaluate("1 / 3"), 1 / 3);
  });
});
