import type { ProjectInstructionCompilerUsage } from "./types.ts";

const COMPILER_USAGE_KEYS = ["input", "output", "cacheRead", "cacheWrite", "total"] as const;

export function parseProjectInstructionCompilerUsage(
  value: unknown,
  rejectUnknownFields: boolean,
): ProjectInstructionCompilerUsage | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const usage = value as Record<string, unknown>;
  if (
    rejectUnknownFields &&
    (Object.keys(usage).length !== COMPILER_USAGE_KEYS.length ||
      COMPILER_USAGE_KEYS.some((key) => !Object.hasOwn(usage, key)))
  ) {
    return undefined;
  }
  const projected = {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    total: usage.total,
  };
  if (!Object.values(projected).every((entry) => typeof entry === "number" && Number.isFinite(entry) && entry >= 0)) {
    return undefined;
  }
  return {
    input: projected.input as number,
    output: projected.output as number,
    cacheRead: projected.cacheRead as number,
    cacheWrite: projected.cacheWrite as number,
    total: projected.total as number,
  };
}
