// Token types for the calculator parser

type Token =
  | { kind: "number"; value: number }
  | { kind: "plus" }
  | { kind: "minus" }
  | { kind: "star" }
  | { kind: "slash" }
  | { kind: "lparen" }
  | { kind: "rparen" }
  | { kind: "eof" };

// --- Lexer ---

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

    // Number (integer or decimal)
    if (ch >= "0" && ch <= "9") {
      let numStr = "";
      while (i < input.length && (input[i] >= "0" && input[i] <= "9" || input[i] === ".")) {
        numStr += input[i];
        i++;
      }
      tokens.push({ kind: "number", value: parseFloat(numStr) });
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
        throw new Error(`Unexpected character '${ch}' at position ${i}`);
    }
    i++;
  }

  tokens.push({ kind: "eof" });
  return tokens;
}

// --- Parser (recursive descent) ---
//
// Grammar (standard precedence, left associative):
//   Expression  → Term (('+' | '-') Term)*
//   Term        → Factor (('*' | '/') Factor)*
//   Factor      → '-' Factor | '(' Expression ')' | Number

class Parser {
  private tokens: Token[];
  private pos: number;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.pos = 0;
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private consume(expectedKind: Token["kind"]): Token {
    const token = this.peek();
    if (token.kind !== expectedKind) {
      throw new Error(
        `Unexpected token '${this.describe(token)}', expected '${expectedKind}'`
      );
    }
    this.pos++;
    return token;
  }

  private describe(token: Token): string {
    switch (token.kind) {
      case "number":
        return String(token.value);
      case "eof":
        return "end of expression";
      default:
        return token.kind;
    }
  }

  public parse(): number {
    const result = this.expression();

    if (this.peek().kind !== "eof") {
      throw new Error(`Unexpected token '${this.describe(this.peek())}' after valid expression`);
    }

    return result;
  }

  // Expression → Term (('+' | '-') Term)*
  private expression(): number {
    let left = this.term();

    while (this.peek().kind === "plus" || this.peek().kind === "minus") {
      const op = this.peek().kind;
      this.pos++;
      const right = this.term();

      if (op === "plus") {
        left = left + right;
      } else {
        left = left - right;
      }
    }

    return left;
  }

  // Term → Factor (('*' | '/') Factor)*
  private term(): number {
    let left = this.factor();

    while (this.peek().kind === "star" || this.peek().kind === "slash") {
      const op = this.peek().kind;
      this.pos++;
      const right = this.factor();

      if (op === "slash") {
        if (right === 0) {
          throw new Error("Division by zero");
        }
        left = left / right;
      } else {
        left = left * right;
      }
    }

    return left;
  }

  // Factor → '-' Factor | '(' Expression ')' | Number
  private factor(): number {
    const token = this.peek();

    if (token.kind === "minus") {
      // Unary minus (or subtraction at start / after '(')
      this.pos++;
      return -this.factor();
    }

    if (token.kind === "plus") {
      // Unary plus – consume and recurse
      this.pos++;
      return this.factor();
    }

    if (token.kind === "lparen") {
      this.consume("lparen");
      const value = this.expression();
      this.consume("rparen");
      return value;
    }

    if (token.kind === "number") {
      this.pos++;
      return token.value;
    }

    if (token.kind === "eof") {
      throw new Error("Unexpected end of expression");
    }

    throw new Error(`Unexpected token '${this.describe(token)}'`);
  }
}

// --- Public API ---

/**
 * Evaluates a mathematical expression string and returns the numeric result.
 *
 * Supports:
 *  - Decimal literals (e.g. 7.5, 0.001)
 *  - Binary operators: +, -, *, /
 *  - Unary minus (e.g. -2, -(-3))
 *  - Parentheses for grouping
 *  - Whitespace (ignored)
 *
 * Throws Error for malformed expressions or division by zero.
 */
export function evaluate(input: string): number {
  if (typeof input !== "string") {
    throw new Error("Input must be a string");
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error("Empty expression");
  }

  const tokens = tokenize(trimmed);
  const parser = new Parser(tokens);
  return parser.parse();
}
