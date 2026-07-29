import { evaluate } from "./calculator.ts";

const expr = process.argv.slice(2).join(" ");
if (!expr) {
  process.stderr.write("Usage: calc <expression>\n");
  process.exit(1);
}

try {
  const result = evaluate(expr);
  process.stdout.write(`${result}\n`);
} catch (err) {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
