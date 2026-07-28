import { evaluate } from "./calculator.ts";

const expression = process.argv.slice(2).join(" ");

try {
  const result = evaluate(expression);
  console.log(result);
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exit(1);
}
