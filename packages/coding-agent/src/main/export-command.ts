import chalk from "chalk";
import type { parseArgs } from "../cli/args.ts";
import { exportFromFile } from "../core/export-html/index.ts";

export async function handleExportCommand(parsed: ReturnType<typeof parseArgs>): Promise<void> {
  if (!parsed.export) return;

  let result: string;
  try {
    const outputPath = parsed.messages.length > 0 ? parsed.messages[0] : undefined;
    result = await exportFromFile(parsed.export, outputPath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to export session";
    console.error(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
  console.log(`Exported to: ${result}`);
  process.exit(0);
}
