/**
 * Recursive-descent parser for arithmetic expressions.
 *
 * Grammar (operator precedence, lowest to highest):
 *   Expression  → Sum
 *   Sum         → Product ( ('+' | '-') Product )*
 *   Product     → Unary ( ('*' | '/') Unary )*
 *   Unary       → '-' Unary | Primary
 *   Primary     → NUMBER | '(' Expression ')'
 */

export function evaluate(input: string): number {
  const parser = new Parser(input);
  const result = parser.parse();
  parser.expectEnd();
  return result;
}

class Parser {
  private pos = 0;
  private readonly src: string;
  private readonly len: number;

  constructor(src: string) {
    this.src = src;
    this.len = src.length;
  }

  /* ── helpers ─────────────────────────────────────────────── */

  /** Peek at the current character without consuming it. */
  private peek(): string | undefined {
    return this.src[this.pos];
  }

  /** Consume and return the current character. */
  private advance(): string {
    return this.src[this.pos++];
  }

  /** Skip whitespace. */
  private skipSpaces(): void {
    while (this.pos < this.len && /\s/.test(this.src[this.pos])) {
      this.pos++;
    }
  }

  /** Ensure every character was consumed (no trailing junk). */
  expectEnd(): void {
    this.skipSpaces();
    if (this.pos < this.len) {
      throw new Error(
        `Unexpected character "${this.src[this.pos]}" at position ${this.pos} in expression`,
      );
    }
  }

  /* ── lexer helpers ───────────────────────────────────────── */

  /** Parse a decimal number literal (integer or floating-point). */
  private readNumber(): number {
    const start = this.pos;
    while (this.pos < this.len && /[0-9]/.test(this.src[this.pos])) {
      this.pos++;
    }
    if (this.pos < this.len && this.src[this.pos] === ".") {
      this.pos++;
      while (this.pos < this.len && /[0-9]/.test(this.src[this.pos])) {
        this.pos++;
      }
    }
    const text = this.src.slice(start, this.pos);
    const value = Number(text);
    if (Number.isNaN(value)) {
      throw new Error(`Invalid number "${text}" at position ${start} in expression`);
    }
    return value;
  }

  /* ── parser (recursive descent) ──────────────────────────── */

  /** Entry point: parse the full expression. */
  parse(): number {
    this.skipSpaces();
    if (this.pos === this.len) {
      throw new Error("Unexpected end of expression: input is empty");
    }
    return this.sum();
  }

  /** Sum  → Product ( ('+' | '-') Product )*  (left-associative) */
  private sum(): number {
    let left = this.product();
    while (this.pos < this.len) {
      this.skipSpaces();
      const op = this.peek();
      if (op !== "+" && op !== "-") break;
      this.advance();
      const right = this.product();
      if (op === "+") left += right;
      else left -= right;
    }
    return left;
  }

  /** Product → Unary ( ('*' | '/') Unary )*  (left-associative) */
  private product(): number {
    let left = this.unary();
    while (this.pos < this.len) {
      this.skipSpaces();
      const op = this.peek();
      if (op !== "*" && op !== "/") break;
      this.advance();
      const right = this.unary();
      if (op === "/") {
        if (right === 0) throw new Error("Division by zero");
        left /= right;
      } else {
        left *= right;
      }
    }
    return left;
  }

  /** Unary → '-' Unary | Primary */
  private unary(): number {
    this.skipSpaces();
    if (this.peek() === "-") {
      this.advance();
      return -this.unary();
    }
    return this.primary();
  }

  /** Primary → NUMBER | '(' Expression ')' */
  private primary(): number {
    this.skipSpaces();

    if (this.pos === this.len) {
      throw new Error("Unexpected end of expression");
    }

    const ch = this.peek();

    if (ch === "(") {
      this.advance(); // consume '('
      this.skipSpaces();
      const result = this.sum();
      this.skipSpaces();
      const close = this.peek();
      if (close !== ")") {
        throw new Error(
          `Expected ')' but found "${close ?? "end of input"}" at position ${this.pos} in expression`,
        );
      }
      this.advance(); // consume ')'
      return result;
    }

    if (ch === ")" || ch === "+" || ch === "*") {
      throw new Error(
        `Unexpected character "${ch ?? "unknown"}" at position ${this.pos} in expression`,
      );
    }

    if (ch === "-") {
      throw new Error(
        `Unexpected '-' at position ${this.pos} in expression (missing operand)`,
      );
    }

    if (ch === "/") {
      throw new Error(
        `Unexpected '/' at position ${this.pos} in expression (missing operand)`,
      );
    }

    if (ch !== undefined && /[0-9]/.test(ch)) {
      return this.readNumber();
    }

    throw new Error(
      `Unexpected character "${ch ?? "unknown"}" at position ${this.pos} in expression`,
    );
  }
}
