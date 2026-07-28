#!/usr/bin/env node
import { evaluate } from "./calculator.ts";

const expr = process.argv.slice(2).join(" ");

if (!expr.trim()) {
  process.stderr.write("Error: No expression provided.\nUsage: npm run calc -- \"2 + 3 * 4\"\n");
  process.exit(1);
}

try {
  const result = evaluate(expr);
  if (!Number.isFinite(result)) {
    process.stderr.write(`Error: Result is not a finite number (${result})\n`);
    process.exit(1);
  }
  console.log(result);
} catch (err) {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
