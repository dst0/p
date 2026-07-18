// Recursive-descent parser with proper precedence and unary minus

class Parser {
  private pos = 0;

  constructor(private expression: string) {}

  public evaluate(): number {
    this.skipWhitespace();
    const result = this.parseExpression();
    this.skipWhitespace();
    if (this.pos < this.expression.length) {
      throw new Error(
        `Unexpected character '${this.expression[this.pos]}' at position ${this.pos} in expression`
      );
    }
    return result;
  }

  private parseExpression(): number {
    let left = this.parseTerm();
    while (true) {
      this.skipWhitespace();
      if (this.match("+")) {
        left = left + this.parseTerm();
      } else if (this.match("-")) {
        left = left - this.parseTerm();
      } else {
        break;
      }
    }
    return left;
  }

  private parseTerm(): number {
    let left = this.parseFactor();
    while (true) {
      this.skipWhitespace();
      if (this.match("*")) {
        left = left * this.parseFactor();
      } else if (this.match("/")) {
        const divisor = this.parseFactor();
        if (divisor === 0) {
          throw new Error("Division by zero");
        }
        left = left / divisor;
      } else {
        break;
      }
    }
    return left;
  }

  private parseFactor(): number {
    this.skipWhitespace();

    // Handle unary minus
    if (this.match("-")) {
      return -this.parseFactor();
    }

    return this.parsePrimary();
  }

  private parsePrimary(): number {
    this.skipWhitespace();

    // Parenthesized expression
    if (this.match("(")) {
      const result = this.parseExpression();
      this.skipWhitespace();
      if (!this.match(")")) {
        throw new Error("Missing closing parenthesis");
      }
      return result;
    }

    // Number (integer or decimal)
    return this.parseNumber();
  }

  private parseNumber(): number {
    const start = this.pos;
    let hasDigits = false;
    let hasDot = false;

    while (this.pos < this.expression.length) {
      const ch = this.expression[this.pos];
      if (ch >= "0" && ch <= "9") {
        hasDigits = true;
        this.pos++;
      } else if (ch === "." && !hasDot) {
        hasDot = true;
        this.pos++;
      } else {
        break;
      }
    }

    if (!hasDigits) {
      throw new Error(
        this.pos >= this.expression.length
          ? "Unexpected end of expression"
          : `Unexpected character '${this.expression[this.pos]}' at position ${this.pos} in expression`
      );
    }

    const raw = this.expression.slice(start, this.pos);
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid number: ${raw}`);
    }
    return value;
  }

  private skipWhitespace(): void {
    while (
      this.pos < this.expression.length &&
      (this.expression[this.pos] === " " ||
        this.expression[this.pos] === "\t" ||
        this.expression[this.pos] === "\n" ||
        this.expression[this.pos] === "\r")
    ) {
      this.pos++;
    }
  }

  private match(ch: string): boolean {
    if (this.pos < this.expression.length && this.expression[this.pos] === ch) {
      this.pos++;
      return true;
    }
    return false;
  }
}

export function evaluate(expression: string): number {
  if (typeof expression !== "string" || expression.trim() === "") {
    throw new Error("Invalid expression: empty input");
  }
  return new Parser(expression).evaluate();
}
