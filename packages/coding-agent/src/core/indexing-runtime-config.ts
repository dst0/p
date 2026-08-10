import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function sortConfiguration(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortConfiguration);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortConfiguration(entry)]),
  );
}

export function computeIndexingRuntimeConfigFingerprint(agentDir: string): string {
  const configPath = path.join(agentDir, "code-rag.json");
  let configuration: unknown = {};
  try {
    configuration = JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown;
  } catch {
    // Missing configuration resolves to the runtime defaults.
  }
  return createHash("sha256")
    .update(JSON.stringify(sortConfiguration(configuration)))
    .digest("hex");
}
