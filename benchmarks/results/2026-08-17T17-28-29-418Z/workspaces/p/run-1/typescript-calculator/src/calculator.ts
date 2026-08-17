export function evaluate(input: string): number {
  const tokens = tokenize(input);
  const result = parseExpression(tokens);
  if (tokens.pos < tokens.values.length) {
    throw new Error(`Unexpected token "${tokens.values[tokens.pos]}" at position ${tokens.pos}`);
  }
  return result;
}

// --- Tokenizer ---

interface TokenStream {
  values: string[];
  pos: number;
}

function tokenize(input: string): TokenStream {
  const values: string[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    // skip whitespace
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }

    // numbers (decimal literals)
    if (ch >= "0" && ch <= "9") {
      let num = "";
      while (i < input.length && (input[i] >= "0" && input[i] <= "9" || input[i] === ".")) {
        num += input[i];
        i++;
      }
      values.push(num);
      continue;
    }

    // operators and parens
    if ("+-*/()".includes(ch)) {
      values.push(ch);
      i++;
      continue;
    }

    throw new Error(`Invalid character "${ch}" in expression`);
  }

  return { values, pos: 0 };
}

// --- Parser (recursive descent) ---

// expression -> additive
function parseExpression(ts: TokenStream): number {
  return parseAdditive(ts);
}

// additive -> multiplicative (('+' | '-') multiplicative)*
function parseAdditive(ts: TokenStream): number {
  let result = parseMultiplicative(ts);

  while (ts.pos < ts.values.length && (ts.values[ts.pos] === "+" || ts.values[ts.pos] === "-")) {
    const op = ts.values[ts.pos++];
    const right = parseMultiplicative(ts);
    if (op === "+") {
      result = result + right;
    } else {
      result = result - right;
    }
  }

  return result;
}

// multiplicative -> unary (('*' | '/') unary)*
function parseMultiplicative(ts: TokenStream): number {
  let result = parseUnary(ts);

  while (ts.pos < ts.values.length && (ts.values[ts.pos] === "*" || ts.values[ts.pos] === "/")) {
    const op = ts.values[ts.pos++];
    const right = parseUnary(ts);
    if (op === "*") {
      result = result * right;
    } else {
      if (right === 0) {
        throw new Error("Division by zero");
      }
      result = result / right;
    }
  }

  return result;
}

// unary -> '-' unary | atom
function parseUnary(ts: TokenStream): number {
  if (ts.pos < ts.values.length && ts.values[ts.pos] === "-") {
    ts.pos++;
    return -parseUnary(ts);
  }
  return parseAtom(ts);
}

// atom -> NUMBER | '(' expression ')'
function parseAtom(ts: TokenStream): number {
  if (ts.pos >= ts.values.length) {
    throw new Error("Unexpected end of expression");
  }

  const token = ts.values[ts.pos];

  if (token === "(") {
    ts.pos++;
    const result = parseExpression(ts);
    if (ts.pos >= ts.values.length || ts.values[ts.pos] !== ")") {
      throw new Error("Unexpected end of expression: missing ')'");
    }
    ts.pos++;
    return result;
  }

  if (token === ")") {
    throw new Error(`Unexpected token ")"`);
  }

  // must be a number
  const num = Number(token);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid number "${token}"`);
  }
  ts.pos++;
  return num;
}
