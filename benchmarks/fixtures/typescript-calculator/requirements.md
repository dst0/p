# TypeScript calculator

Build a small calculator library and CLI.

- Export evaluate(expression: string): number from src/calculator.ts.
- Support decimal literals, whitespace, binary +, -, *, /, unary minus, and parentheses.
- Use normal precedence and left associativity.
- Throw an Error for malformed expressions and division by zero.
- Add src/cli.ts. npm run calc -- "2 + 3 * (4 - 1)" must print 11. Invalid input must exit nonzero and write a useful message to stderr.
- Add meaningful tests in test/calculator.test.ts without changing the contract test.
- Run npm test and npm run typecheck before finishing.
