type Token =
  | { kind: "number"; value: number }
  | { kind: "op"; value: "+" | "-" | "*" | "/" }
  | { kind: "lp" }
  | { kind: "rp" };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }

    if (ch >= "0" && ch <= "9") {
      let start = i;
      let hasDot = false;
      while (i < input.length) {
        const c = input[i];
        if (c === ".") {
          if (hasDot) break;
          hasDot = true;
          i++;
        } else if (c >= "0" && c <= "9") {
          i++;
        } else {
          break;
        }
      }
      tokens.push({ kind: "number", value: parseFloat(input.slice(start, i)) });
      continue;
    }

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

    throw new Error(`Unexpected character '${ch}' at position ${i}`);
  }

  return tokens;
}

class Parser {
  private pos = 0;

  constructor(private tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private consume(): Token {
    const token = this.tokens[this.pos];
    this.pos++;
    return token;
  }

  private expect(kind: "rp"): Token {
    const t = this.consume();
    if (t?.kind !== kind) {
      throw new Error(`Unexpected token, expected ')'`);
    }
    return t;
  }

  parse(): number {
    const result = this.expr();
    if (this.pos < this.tokens.length) {
      const t = this.tokens[this.pos];
      throw new Error(`Unexpected token after expression: '${String(t.kind === "op" ? t.value : t.kind)}'`);
    }
    return result;
  }

  private expr(): number {
    let left = this.term();
    while (true) {
      const t = this.peek();
      if (t?.kind === "op" && (t.value === "+" || t.value === "-")) {
        this.consume();
        const right = this.term();
        if (t.value === "+") {
          left = left + right;
        } else {
          left = left - right;
        }
      } else {
        break;
      }
    }
    return left;
  }

  private term(): number {
    let left = this.unary();
    while (true) {
      const t = this.peek();
      if (t?.kind === "op" && (t.value === "*" || t.value === "/")) {
        this.consume();
        const right = this.unary();
        if (t.value === "*") {
          left = left * right;
        } else {
          if (right === 0) {
            throw new Error("Division by zero");
          }
          left = left / right;
        }
      } else {
        break;
      }
    }
    return left;
  }

  private unary(): number {
    const t = this.peek();
    if (t?.kind === "op" && t.value === "-") {
      this.consume();
      return -this.unary();
    }
    if (t?.kind === "op" && t.value === "+") {
      this.consume();
      return this.unary();
    }
    return this.atom();
  }

  private atom(): number {
    const t = this.peek();
    if (t?.kind === "number") {
      this.consume();
      return t.value;
    }
    if (t?.kind === "lp") {
      this.consume();
      const result = this.expr();
      this.expect("rp");
      return result;
    }
    if (t?.kind === "op") {
      throw new Error(`Unexpected operator '${t.value}' — expression is incomplete or invalid`);
    }
    if (t === undefined) {
      throw new Error("Unexpected end of expression");
    }
    throw new Error(`Unexpected token ')'`);
  }
}

export function evaluate(input: string): number {
  if (input.trim().length === 0) {
    throw new Error("Empty expression");
  }
  const tokens = tokenize(input);
  if (tokens.length === 0) {
    throw new Error("Empty expression");
  }
  const parser = new Parser(tokens);
  return parser.parse();
}
