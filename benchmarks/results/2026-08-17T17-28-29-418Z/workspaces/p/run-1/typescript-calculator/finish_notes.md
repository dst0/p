# Finish Notes — TypeScript Calculator

## Verification Summary

All requirements from `requirements.md` have been implemented and verified:

### Type Checking
- `npm run typecheck` → passed (0 errors)

### Tests
- `npm test` → 36/36 tests passed (5 contract + 31 unit tests)

### CLI
- `npm run calc -- "2 + 3 * (4 - 1)"` → prints `11` ✓
- Invalid input (e.g. `2 / 0`) → exits with code 1, prints error to stderr ✓

## Files Created
- **src/calculator.ts** — Recursive-descent parser with tokenizer, supporting decimal literals, whitespace, binary `+ - * /`, unary minus, parentheses, normal precedence, left associativity, and proper error handling for malformed input and division by zero.
- **src/cli.ts** — CLI entry point that reads an expression from argv, evaluates it, and prints the result (or exits nonzero with stderr message on error).
- **test/calculator.test.ts** — 31 unit tests covering basic arithmetic, precedence, associativity, parentheses (including nested), decimals, unary minus (chained, before parens, in expressions), whitespace, and error cases (empty input, trailing operators, missing parens, unexpected tokens, invalid characters, single numbers).

## Design
The parser uses a standard recursive-descent grammar:
- `expression → additive`
- `additive → multiplicative (('+' | '-') multiplicative)*`
- `multiplicative → unary (('*' | '/') unary)*`
- `unary → '-' unary | atom`
- `atom → NUMBER | '(' expression ')'`

This naturally enforces correct precedence and left associativity.
