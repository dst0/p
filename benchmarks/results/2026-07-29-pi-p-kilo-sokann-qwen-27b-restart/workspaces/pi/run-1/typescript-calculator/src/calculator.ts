// Recursive-descent parser with proper precedence:
//   expression  := additive
//   additive    := multiplicative (('+' | '-') multiplicative)*
//   multiplicative := unary (('*' | '/') unary)*
//   unary       := '-' unary | primary
//   primary     := NUMBER | '(' expression ')'

type Token =
  | { kind: "number"; value: number }
  | { kind: "op"; value: "+" | "-" | "*" | "/" }
  | { kind: "lp" }
  | { kind: "rp" }
  | { kind: "eof" };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    // skip whitespace
    if (ch <= " ") {
      i++;
      continue;
    }

    // numbers (integers and decimals)
    if ((ch >= "0" && ch <= "9") || ch === ".") {
      let start = i;
      let hasDot = ch === ".";
      i++;
      while (i < input.length) {
        const c = input[i];
        if (c >= "0" && c <= "9") {
          i++;
        } else if (c === "." && !hasDot) {
          hasDot = true;
          i++;
        } else {
          break;
        }
      }
      const numStr = input.slice(start, i);
      if (numStr === ".") throw new SyntaxError("Invalid number \".\"");
      tokens.push({ kind: "number", value: parseFloat(numStr) });
      continue;
    }

    // operators and parens
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      tokens.push({ kind: "op", value: ch as "+" | "-" | "*" | "/" });
      i++;
      continue;
    }

    if (ch === "(") {
      tokens.push({ kind: "lp" });
      i++;
      continue;
    }

    if (ch === ")") {
      tokens.push({ kind: "rp" });
      i++;
      continue;
    }

    throw new SyntaxError("Unexpected character at position " + i);
  }

  tokens.push({ kind: "eof" });
  return tokens;
}

// Parser helpers
type ParserCtx = { tokens: Token[]; pos: number };

function peek(ctx: ParserCtx): Token {
  return ctx.tokens[ctx.pos];
}

function consume(ctx: ParserCtx, kind: string, expected?: string): Token {
  const tok = peek(ctx);
  if (tok.kind !== kind || (expected !== undefined && (tok as any).value !== expected)) {
    throw new SyntaxError("Invalid expression: expected " + kind + " at position " + ctx.pos);
  }
  ctx.pos++;
  return tok;
}

// expression := additive
function parseExpression(ctx: ParserCtx): number {
  return parseAdditive(ctx);
}

// additive := multiplicative (('+' | '-') multiplicative)*
function parseAdditive(ctx: ParserCtx): number {
  let left = parseMultiplicative(ctx);

  while (true) {
    const tok = peek(ctx);
    if (tok.kind === "op" && (tok.value === "+" || tok.value === "-")) {
      ctx.pos++;
      const right = parseMultiplicative(ctx);
      left = tok.value === "+" ? left + right : left - right;
    } else {
      break;
    }
  }

  return left;
}

// multiplicative := unary (('*' | '/') unary)*
function parseMultiplicative(ctx: ParserCtx): number {
  let left = parseUnary(ctx);

  while (true) {
    const tok = peek(ctx);
    if (tok.kind === "op" && (tok.value === "*" || tok.value === "/")) {
      ctx.pos++;
      const right = parseUnary(ctx);
      if (tok.value === "/") {
        if (right === 0) {
          throw new Error("Division by zero");
        }
        left = left / right;
      } else {
        left = left * right;
      }
    } else {
      break;
    }
  }

  return left;
}

// unary := '-' unary | primary
function parseUnary(ctx: ParserCtx): number {
  const tok = peek(ctx);
  if (tok.kind === "op" && tok.value === "-") {
    ctx.pos++;
    return -parseUnary(ctx);
  }
  return parsePrimary(ctx);
}

// primary := NUMBER | '(' expression ')'
function parsePrimary(ctx: ParserCtx): number {
  const tok = peek(ctx);

  if (tok.kind === "number") {
    ctx.pos++;
    return tok.value;
  }

  if (tok.kind === "lp") {
    ctx.pos++; // consume '('
    const result = parseExpression(ctx);
    consume(ctx, "rp", ")");
    return result;
  }

  // Unexpected token
  const desc = tok.kind === "eof"
    ? "end of input"
    : tok.kind === "op"
      ? '"' + tok.value + '"'
      : '"' + tok.kind + '"';
  throw new SyntaxError("Invalid expression: unexpected " + desc);
}

/**
 * Evaluate a mathematical expression string and return the result.
 *
 * Supports: decimal literals, binary +, -, *, /, unary minus, parentheses.
 * Operators follow standard precedence (multiplicative before additive)
 * with left associativity.
 *
 * Throws Error for malformed expressions or division by zero.
 */
export function evaluate(input: string): number {
  if (input.trim().length === 0) {
    throw new Error("Invalid expression: empty input");
  }

  const tokens = tokenize(input);
  const ctx: ParserCtx = { tokens, pos: 0 };
  const result = parseExpression(ctx);

  // If we haven't consumed everything, there's trailing junk.
  if (peek(ctx).kind !== "eof") {
    throw new SyntaxError("Unexpected token after expression at position " + ctx.pos);
  }

  return result;
}
