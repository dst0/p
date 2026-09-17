import { existsSync } from "node:fs";
import type { RunnerOptions } from "./runner-options.ts";

export function validateBenchmarkRuntimeInputs(options: RunnerOptions): void {
  if (options.certified && (options.certifiedNetworkHosts ?? []).length === 0) {
    throw new Error("At least one certified network host is required via --certified-network-host");
  }
  for (const host of options.certifiedNetworkHosts ?? []) {
    const match = /^([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(?::(\d{1,5}))?$/u.exec(host);
    const port = match?.[2] ? Number(match[2]) : undefined;
    if (!match || port === undefined || port === 0 || port > 65_535) {
      throw new Error(`Invalid certified network host: ${host}`);
    }
  }
  if (!existsSync(options.pCli)) {
    throw new Error(`Missing ${options.pCli}; build packages/coding-agent before running the benchmark`);
  }
  if (options.projectInstructions && !existsSync(options.projectInstructionsFile)) {
    throw new Error(`Missing ${options.projectInstructionsFile}`);
  }
  if (options.projectInstructions && !existsSync(options.projectInstructionProbe)) {
    throw new Error(`Missing ${options.projectInstructionProbe}`);
  }
  if (options.agents.some((agent) => agent === "pi" || agent === "p") && !existsSync(options.modelsFile)) {
    console.warn(`Warning: models file not found at ${options.modelsFile}; built-in provider config will be used`);
  }
  if (options.agents.includes("kilo") && !existsSync(options.kiloConfig)) {
    throw new Error(`Kilo config not found at ${options.kiloConfig}`);
  }
}
