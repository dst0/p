import { evaluate } from "./calculator.ts";

const args = process.argv.slice(2);

if (args.length === 0) {
  process.stderr.write("Usage: calc <expression>\n");
  process.exit(1);
}

const expression = args.join(" ");

try {
  const result = evaluate(expression);
  console.log(result);
} catch (err: any) {
  process.stderr.write(`Error: ${err.message || err}\n`);
  process.exit(1);
}
