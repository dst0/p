#!/usr/bin/env tsx
import { evaluate } from "./calculator.ts";

function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    process.stderr.write("Usage: calc \"<expression>\"\n");
    process.exit(1);
  }

  const expression = args.join(" ");

  try {
    const result = evaluate(expression);
    // Print integer results without trailing decimal, decimals normally.
    if (Number.isFinite(result)) {
      const output = Number.isInteger(result) ? String(result) : String(result);
      process.stdout.write(`${output}\n`);
    } else {
      process.stderr.write(`Error: evaluation produced ${result}\n`);
      process.exit(1);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${message}\n`);
    process.exit(1);
  }
}

main();
