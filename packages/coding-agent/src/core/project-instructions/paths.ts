import { join } from "node:path";

export function getProjectInstructionFallbackPath(cacheDir: string, inputHash: string): string {
  return join(cacheDir, "inputs", inputHash, "fallback.md");
}
