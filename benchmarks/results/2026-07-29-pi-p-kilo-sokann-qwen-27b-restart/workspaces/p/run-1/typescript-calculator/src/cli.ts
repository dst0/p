import { evaluate } from "./calculator.ts";

const args = process.argv.slice(2);

if (args.length === 0) {
  process.stderr.write("Usage: npm run calc -- \"expression\"\n");
  process.exit(1);
}

const expression = args.join(" ");

try {
  const result = evaluate(expression);
  // Print integer values without decimal point
  if (Number.isInteger(result)) {
    console.log(result);
  } else {
    console.log(result);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
