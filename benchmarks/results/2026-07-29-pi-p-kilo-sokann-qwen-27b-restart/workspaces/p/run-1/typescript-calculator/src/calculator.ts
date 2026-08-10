// Token types for the calculator expression language
type Token =
  | { kind: "number"; value: number }
  | { kind: "operator"; value: "+" | "-" | "*" | "/" }
  | { kind: "lparen" }
  | { kind: "rparen" };

/**
 * Tokenize an expression string into a stream of tokens.
 */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    // Skip whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Number (decimal literals)
    if (/\d/.test(ch) || (ch === "." && i + 1 < input.length && /\d/.test(input[i + 1]))) {
      let num = "";
      while (i < input.length && (/\d/.test(input[i]) || input[i] === ".")) {
        num += input[i];
        i++;
      }
      tokens.push({ kind: "number", value: parseFloat(num) });
      continue;
    }

    // Operators
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      tokens.push({ kind: "operator", value: ch as "+" | "-" | "*" | "/" });
      i++;
      continue;
    }

    // Parentheses
    if (ch === "(") {
      tokens.push({ kind: "lparen" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen" });
      i++;
      continue;
    }

    throw new Error(`Unexpected character '${ch}' at position ${i}`);
  }

  return tokens;
}

/**
 * Recursive-descent parser with proper precedence:
 *   expr       -> addition
 *   addition   -> multiplication (('+' | '-') multiplication)*
 *   multiplication -> unary (('*' | '/') unary)*
 *   unary      -> '-' unary | atom
 *   atom       -> number | '(' expr ')'
 */
export function parse(tokens: Token[]): number {
  let pos = 0;

  function peek(): Token | undefined {
    return tokens[pos];
  }

  function advance(): Token {
    return tokens[pos++];
  }

  function isOp(chars: ("+" | "-" | "*" | "/")[]): boolean {
    const t = peek();
    return t?.kind === "operator" && chars.includes(t.value);
  }

  function addition(): number {
    let result = multiplication();

    while (isOp(["+", "-"])) {
      const op = advance();
      const right = multiplication();
      if (op.kind === "operator") {
        if (op.value === "+") result += right;
        else result -= right;
      }
    }

    return result;
  }

  function multiplication(): number {
    let result = unary();

    while (isOp(["*", "/"])) {
      const op = advance();
      const right = unary();
      if (op.kind === "operator") {
        if (op.value === "/") {
          if (right === 0) throw new Error("Division by zero");
          result /= right;
        } else {
          result *= right;
        }
      }
    }

    return result;
  }

  function unary(): number {
    if (isOp(["-"])) {
      advance();
      return -unary();
    }
    if (isOp(["+"])) {
      advance();
      return unary();
    }
    return atom();
  }

  function atom(): number {
    const token = peek();

    if (token?.kind === "number") {
      advance();
      return token.value;
    }

    if (token?.kind === "lparen") {
      advance(); // consume '('
      const result = addition();
      const close = peek();
      if (!close || close.kind !== "rparen") {
        throw new Error("Unexpected end of expression; expected ')'");
      }
      advance(); // consume ')'
      return result;
    }

    throw new Error(`Invalid expression at token ${pos}`);
  }

  const result = addition();

  if (pos < tokens.length) {
    throw new Error(`Unexpected token after valid expression at position ${pos}`);
  }

  return result;
}

/**
 * Evaluate a mathematical expression string and return the numeric result.
 * Supports: decimal numbers, +, -, *, /, unary minus, parentheses.
 * Throws Error for malformed input or division by zero.
 */
export function evaluate(input: string): number {
  if (!input.trim()) {
    throw new Error("Empty expression");
  }
  const tokens = tokenize(input);
  if (tokens.length === 0) {
    throw new Error("Empty expression");
  }
  return parse(tokens);
}
