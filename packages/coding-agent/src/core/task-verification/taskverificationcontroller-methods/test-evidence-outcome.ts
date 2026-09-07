import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { TaskVerificationEvidence } from "../types.ts";
import { focusedShellInvocation } from "./focused-shell-command.ts";
import { commandContainsTestInvocation } from "./test-command-invocation.ts";
import { hasPositivePassingTestResult } from "./test-invocation-selection.ts";

const PACKAGE_MANAGERS = new Set(["bun", "npm", "pnpm", "yarn"]);

interface MissingScriptEvidence {
  canonicalOutput: boolean;
}

export function classifyTestEvidence(
  descriptor: string,
  fullOutput: string,
  isError: boolean,
  sessionCwd: string,
): Pick<TaskVerificationEvidence, "isError" | "testOutcome" | "verificationFailureKind"> | undefined {
  if (!commandContainsTestInvocation(descriptor)) return undefined;
  const missingScript = missingPackageScriptEvidence(descriptor, fullOutput, sessionCwd);
  const testOutcome = !isError && !missingScript && hasPositivePassingTestResult(fullOutput) ? "passed" : "unconfirmed";
  const verificationFailureKind = missingScript?.canonicalOutput ? "missing_test_script" : undefined;
  return { isError: isError || missingScript !== undefined, testOutcome, verificationFailureKind };
}

export function evidenceHasPositivePassingTestResult(evidence: TaskVerificationEvidence): boolean {
  return evidence.testOutcome === undefined
    ? hasPositivePassingTestResult(evidence.outputSummary)
    : evidence.testOutcome === "passed";
}

function missingPackageScriptEvidence(
  descriptor: string,
  output: string,
  sessionCwd: string,
): MissingScriptEvidence | undefined {
  const invocation = focusedShellInvocation(descriptor);
  const words = invocation?.words;
  const manager = words?.[0];
  if (!manager || !PACKAGE_MANAGERS.has(manager)) return undefined;
  const requestedScript = requestedPackageScript(manager, words ?? []);
  if (!requestedScript) return undefined;
  const reportedScript = missingScriptName(manager, output);
  const packageDirectory = resolve(sessionCwd, invocation?.workingDirectory ?? ".");
  if (reportedScript !== requestedScript || !packageScriptIsAbsent(packageDirectory, requestedScript)) return undefined;
  return { canonicalOutput: missingScriptOutputIsCanonical(manager, output, requestedScript) };
}

function requestedPackageScript(manager: string, words: readonly string[]): string | undefined {
  if (words[1] === "run") return words.length === 3 && words[2]?.startsWith("test") ? words[2] : undefined;
  return manager !== "bun" && words.length === 2 && words[1]?.startsWith("test") ? words[1] : undefined;
}

function packageScriptIsAbsent(packageDirectory: string, script: string): boolean {
  try {
    const manifest: unknown = JSON.parse(readFileSync(resolve(packageDirectory, "package.json"), "utf8"));
    if (!isRecord(manifest)) return false;
    const scripts = manifest.scripts;
    if (scripts === undefined) return true;
    return isRecord(scripts) && !Object.hasOwn(scripts, script);
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function missingScriptOutputIsCanonical(manager: string, output: string, script: string): boolean {
  const lines = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  let diagnosticCount = 0;
  for (const line of lines) {
    if (missingScriptName(manager, line) === script) diagnosticCount += 1;
    else if (!isAllowedPackageManagerContextLine(manager, line)) return false;
  }
  return diagnosticCount === 1;
}

function isAllowedPackageManagerContextLine(manager: string, line: string): boolean {
  if (manager === "npm") {
    return (
      /^npm (?:error|ERR!)$/u.test(line) ||
      /^npm (?:error|ERR!)\s+(?:To see a list of scripts, run:|npm run|A complete log of this run can be found in:\s+\S+)$/u.test(
        line,
      )
    );
  }
  if (manager === "yarn") return /^yarn run v\S+$/u.test(line) || /^info Visit https:\/\/\S+$/u.test(line);
  return false;
}

function missingScriptName(manager: string, output: string): string | undefined {
  const patterns: Record<string, RegExp> = {
    bun: /(?:^|\n)\s*error:\s+Script not found ["']([^"'\n]+)["']\s*(?:\n|$)/iu,
    npm: /(?:^|\n)\s*npm (?:error|ERR!)\s+Missing script:\s*["']?([^"'\n]+?)["']?\s*(?:\n|$)/iu,
    pnpm: /(?:^|\n)\s*ERR_PNPM_NO_SCRIPT\s+Missing script:\s*["']?([^"'\n]+?)["']?\s*(?:\n|$)/iu,
    yarn: /(?:^|\n)\s*error Command ["']([^"'\n]+)["'] not found\.\s*(?:\n|$)/iu,
  };
  return patterns[manager]?.exec(output)?.[1]?.trim();
}
