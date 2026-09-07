import { BENCHMARK_PROJECT_INSTRUCTION_COMPILER_DIAGNOSTICS } from "./diagnostics.ts";

const SAFE_DIAGNOSTICS = new Set(BENCHMARK_PROJECT_INSTRUCTION_COMPILER_DIAGNOSTICS);
const SAFE_FAILURE_KINDS = new Set(["envelope", "root-schema", "constraint-set", "grounding-semantic", "provider"]);

export type CompilerFailure = {
  attemptCount: number;
  failureKinds: string[];
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  elapsedMs: number;
};
export type SeedFailure = { diagnostic: string; compilerFailure?: CompilerFailure };

export function parseSafeSeedFailure(stdout: string): SeedFailure | undefined {
  try {
    const lines = stdout.trim().split(/\r?\n/u);
    const finalLine = lines.at(-1);
    if (!finalLine) return undefined;
    const parsed: unknown = JSON.parse(finalLine);
    if (
      !isRecord(parsed) ||
      parsed.status !== "failed" ||
      typeof parsed.diagnostic !== "string" ||
      !SAFE_DIAGNOSTICS.has(parsed.diagnostic)
    ) {
      return undefined;
    }
    const hasCompilerFailure = Object.hasOwn(parsed, "compilerFailure");
    if (
      !hasExactKeys(parsed, hasCompilerFailure ? ["status", "diagnostic", "compilerFailure"] : ["status", "diagnostic"])
    ) {
      return undefined;
    }
    const requiresCompilerFailure = [
      "project instruction compiler output validation failed",
      "project instruction compiler provider call failed",
      "project instruction compiler model context capacity was insufficient",
    ].includes(parsed.diagnostic);
    if (hasCompilerFailure !== requiresCompilerFailure) return undefined;
    const compilerFailure = hasCompilerFailure ? normalizeSafeCompilerFailure(parsed.compilerFailure) : undefined;
    if (hasCompilerFailure && !compilerFailure) return undefined;
    if (compilerFailure && !failureMatchesDiagnostic(compilerFailure, parsed.diagnostic)) return undefined;
    return { diagnostic: parsed.diagnostic, ...(compilerFailure ? { compilerFailure } : {}) };
  } catch {
    return undefined;
  }
}

export function cloneSeedFailure(value: SeedFailure): SeedFailure {
  return {
    diagnostic: value.diagnostic,
    ...(value.compilerFailure ? { compilerFailure: cloneCompilerFailure(value.compilerFailure) } : {}),
  };
}

function normalizeSafeCompilerFailure(value: unknown): CompilerFailure | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["attemptCount", "failureKinds", "usage", "elapsedMs"])) {
    return undefined;
  }
  const usage = value.usage;
  if (
    typeof value.attemptCount !== "number" ||
    !Number.isInteger(value.attemptCount) ||
    value.attemptCount < 1 ||
    value.attemptCount > 2 ||
    !Array.isArray(value.failureKinds) ||
    value.failureKinds.length !== value.attemptCount ||
    !value.failureKinds.every((kind) => SAFE_FAILURE_KINDS.has(kind)) ||
    !isRecord(usage) ||
    !hasExactKeys(usage, ["input", "output", "cacheRead", "cacheWrite", "total"]) ||
    ![usage.input, usage.output, usage.cacheRead, usage.cacheWrite, usage.total].every(
      (amount) => typeof amount === "number" && Number.isFinite(amount) && amount >= 0,
    ) ||
    typeof value.elapsedMs !== "number" ||
    !Number.isFinite(value.elapsedMs) ||
    value.elapsedMs < 0
  ) {
    return undefined;
  }
  return cloneCompilerFailure(value as CompilerFailure);
}

function cloneCompilerFailure(value: CompilerFailure): CompilerFailure {
  return {
    attemptCount: value.attemptCount,
    failureKinds: [...value.failureKinds],
    usage: {
      input: value.usage.input,
      output: value.usage.output,
      cacheRead: value.usage.cacheRead,
      cacheWrite: value.usage.cacheWrite,
      total: value.usage.total,
    },
    elapsedMs: value.elapsedMs,
  };
}

function failureMatchesDiagnostic(failure: CompilerFailure, diagnostic: string): boolean {
  return failure.failureKinds.includes("provider")
    ? diagnostic === "project instruction compiler provider call failed" ||
        diagnostic === "project instruction compiler model context capacity was insufficient"
    : diagnostic === "project instruction compiler output validation failed";
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
