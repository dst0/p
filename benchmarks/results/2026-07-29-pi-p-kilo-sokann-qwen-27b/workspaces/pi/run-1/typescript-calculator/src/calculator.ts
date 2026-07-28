// Token types for the calculator expression language
type Token =
  | { kind: "number"; value: number }
  | { kind: "plus" }
  | { kind: "minus" }
  | { kind: "star" }
  | { kind: "slash" }
  | { kind: "lparen" }
  | { kind: "rparen" }
  | { kind: "eof" };

/**
 * Tokenize an expression string into an array of tokens.
 */
function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    // Skip whitespace
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }

    // Numbers (integer or decimal)
    if (ch === "." || (ch >= "0" && ch <= "9")) {
      let numStr = "";
      let hasDot = false;
      while (i < input.length && ((input[i] >= "0" && input[i] <= "9") || input[i] === ".")) {
        if (input[i] === ".") {
          if (hasDot) break; // only one decimal point allowed
          hasDot = true;
        }
        numStr += input[i];
        i++;
      }
      const value = parseFloat(numStr);
      if (isNaN(value)) {
        throw new Error(`Invalid number: "${numStr}"`);
      }
      tokens.push({ kind: "number", value });
      continue;
    }

    // Operators and parentheses
    switch (ch) {
      case "+":
        tokens.push({ kind: "plus" });
        break;
      case "-":
        tokens.push({ kind: "minus" });
        break;
      case "*":
        tokens.push({ kind: "star" });
        break;
      case "/":
        tokens.push({ kind: "slash" });
        break;
      case "(":
        tokens.push({ kind: "lparen" });
        break;
      case ")":
        tokens.push({ kind: "rparen" });
        break;
      default:
        throw new Error(`Unexpected character: "${ch}"`);
    }
    i++;
  }

  tokens.push({ kind: "eof" });
  return tokens;
}

// Parser state
interface Parser {
  tokens: Token[];
  pos: number;
}

function newParser(tokens: Token[]): Parser {
  return { tokens, pos: 0 };
}

function peek(p: Parser): Token {
  return p.tokens[p.pos];
}

function consume(p: Parser, kind: Token["kind"]): Token {
  const tok = p.tokens[p.pos];
  if (tok.kind !== kind) {
    throw new Error(
      `Unexpected token "${tokenText(tok)}" — expected "${kind}"`,
    );
  }
  p.pos++;
  return tok;
}

function tokenText(tok: Token): string {
  switch (tok.kind) {
    case "number":
      return String(tok.value);
    case "plus":
      return "+";
    case "minus":
      return "-";
    case "star":
      return "*";
    case "slash":
      return "/";
    case "lparen":
      return "(";
    case "rparen":
      return ")";
    case "eof":
      return "end of input";
  }
}

/**
 * Parse an expression using recursive descent.
 *
 * Grammar (left-associative, standard precedence):
 *   expr       → additive
 *   additive   → multiplicative (('+' | '-') multiplicative)*
 *   multiplicative → unary (('*' | '/') unary)*
 *   unary      → '-' unary | primary
 *   primary    → NUMBER | '(' expr ')'
 */

// --- additive: handles '+' and '-' with left associativity ---
function parseAdditive(p: Parser): number {
  let left = parseMultiplicative(p);

  while (
    peek(p).kind === "plus" ||
    peek(p).kind === "minus"
  ) {
    const op = peek(p);
    consume(p, op.kind);
    const right = parseMultiplicative(p);
    if (op.kind === "plus") {
      left = left + right;
    } else {
      left = left - right;
    }
  }

  return left;
}

// --- multiplicative: handles '*' and '/' with left associativity ---
function parseMultiplicative(p: Parser): number {
  let left = parseUnary(p);

  while (peek(p).kind === "star" || peek(p).kind === "slash") {
    const op = peek(p);
    consume(p, op.kind);
    const right = parseUnary(p);
    if (op.kind === "star") {
      left = left * right;
    } else {
      if (right === 0) {
        throw new Error("Division by zero");
      }
      left = left / right;
    }
  }

  return left;
}

// --- unary: handles unary minus ---
function parseUnary(p: Parser): number {
  if (peek(p).kind === "minus") {
    consume(p, "minus");
    return -parseUnary(p); // allow chained unary: ---5
  }
  return parsePrimary(p);
}

// --- primary: numbers and parenthesized expressions ---
function parsePrimary(p: Parser): number {
  const tok = peek(p);

  if (tok.kind === "number") {
    consume(p, "number");
    return tok.value;
  }

  if (tok.kind === "lparen") {
    consume(p, "lparen");
    const value = parseAdditive(p);
    consume(p, "rparen");
    return value;
  }

  throw new Error(
    `Unexpected token "${tokenText(tok)}" — expected a number or "("`,
  );
}

function parse(tokens: Token[]): number {
  const p = newParser(tokens);
  const result = parseAdditive(p);

  // After parsing, we must have consumed everything (only EOF left)
  if (peek(p).kind !== "eof") {
    throw new Error(
      `Unexpected token "${tokenText(peek(p))}" after expression`,
    );
  }

  return result;
}

/**
 * Evaluate a mathematical expression string and return the result.
 *
 * Supports: decimal literals, binary + - * /, unary minus, parentheses.
 * Uses standard operator precedence and left associativity.
 *
 * @throws Error for malformed expressions, invalid characters, or division by zero.
 */
export function evaluate(expression: string): number {
  if (!expression || !expression.trim()) {
    throw new Error("Invalid expression: empty input");
  }
  const tokens = tokenize(expression);
  return parse(tokens);
}
