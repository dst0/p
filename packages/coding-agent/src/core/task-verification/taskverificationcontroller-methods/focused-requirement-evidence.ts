import { selectorsMatchProofPolicies } from "../requirement-proof-evidence.ts";
import { evidenceHasProofWitnesses } from "../requirement-proof-witnesses.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import { isShellTool } from "../tool-classification.ts";
import type { TaskRequirement, TaskVerificationEvidence } from "../types.ts";
import { evidenceMatchesRequirement } from "./focused-evidence-relevance.ts";
import { focusedTestInvocation, type TestCommandInvocation } from "./test-command-invocation.ts";

const TEST_NAME_OPTIONS = new Set(["-k", "-t", "-run", "--grep", "--test-name-pattern", "--testNamePattern"]);
const TEST_PATH_OPTIONS = new Set(["--runTestsByPath"]);
const TEST_BOOLEAN_OPTIONS = new Set([
  "--changed",
  "--ci",
  "--coverage",
  "--no-color",
  "--run",
  "--runInBand",
  "--silent",
  "--verbose",
  "--watch",
]);
const VACUOUS_TEST_OPTIONS = new Set(["--passWithNoTests"]);
const GENERIC_SELECTOR_TERMS = new Set(["all", "and", "any", "false", "not", "or", "test", "tests", "true"]);
const SELECTOR_TERM_PATTERN = /[\p{L}\p{N}]{3,}/gu;
const SAFE_TEST_NAME_SELECTOR_PATTERN = /^[\p{L}\p{N}\s._:/=,'^$|*-]+$/u;
const FOCUSED_TEST_FILE_PATTERN =
  /(?:^|\/)(?:test_[^/]+\.py|[^/]+_test\.go|[^/]+\.(?:test|spec)\.[cm]?[jt]sx?|tests?\/[^/]+\.rs)(?::[^\s]+)?$/iu;
const POSITIVE_TEST_RESULT_PATTERN =
  /(?:^|\s)---\s+PASS:|\btest result:\s+ok\b[\s\S]*\b[1-9]\d*\s+passed\b|\btests?\s*:?\s*[1-9]\d*\s+passed\b|\b[1-9]\d*\s+(?:tests?\s+)?passed\b|\bpass\s+[1-9]\d*\b/iu;
const FAILED_TEST_RESULT_PATTERN =
  /(?:^|\s)---\s+FAIL:|(?:^|\n)\s*(?:FAIL\b|not ok\b)|\btest result:\s+FAILED\b|\b(?:test files?|tests?)\s*:?\s*[1-9]\d*\s+failed\b|\bfailed tests?\s*:?\s*[1-9]\d*\b|\b[1-9]\d*\s+(?:tests?\s+)?failed\b|\bfail(?:ed)?\s*:?\s*[1-9]\d*\b|\b(?:AssertionError|Unhandled Error):/iu;

export function isFocusedEvidence(
  self: TaskVerificationController,
  evidence: TaskVerificationEvidence,
  requirement: TaskRequirement,
): boolean {
  if (evidence.isError || !isShellTool(evidence.toolName)) return false;
  const selectors = focusedTestSelectors(evidence.descriptor);
  return (
    selectors !== undefined &&
    evidenceMatchesRequirement(requirement, selectors) &&
    selectorsMatchProofPolicies(requirement, selectors) &&
    evidenceHasProofWitnesses(evidence, requirement, self.state.requirementAudit.requirementSetHash) &&
    hasPositivePassingTestResult(evidence.outputSummary) &&
    !FAILED_TEST_RESULT_PATTERN.test(evidence.outputSummary)
  );
}

function hasPositivePassingTestResult(output: string): boolean {
  const withoutContainerSummaries = output.replace(
    /\btest (?:files?|suites?)\s*:?\s*\d+\s+passed(?:\s*\(\d+\))?/giu,
    "",
  );
  return POSITIVE_TEST_RESULT_PATTERN.test(withoutContainerSummaries);
}

export function focusedTestSelectors(command: string, depth = 0): string[] | undefined {
  const invocation = focusedTestInvocation(command, depth);
  return invocation === undefined ? undefined : getFocusedTestSelectors(invocation);
}

function getFocusedTestSelectors(invocation: TestCommandInvocation): string[] | undefined {
  const { args } = invocation;
  if (
    args.some(
      (token) =>
        VACUOUS_TEST_OPTIONS.has(token) || [...VACUOUS_TEST_OPTIONS].some((option) => token.startsWith(`${option}=`)),
    )
  ) {
    return undefined;
  }
  const testNames: string[] = [];
  const paths: string[] = [];
  let positionalOnly = false;
  for (let index = 0; index < args.length; index++) {
    const token = args[index]!;
    if (token === "--") {
      positionalOnly = true;
      continue;
    }
    if (!positionalOnly) {
      const nameValue = optionValue(token, args[index + 1], TEST_NAME_OPTIONS);
      if (nameValue !== undefined) {
        if (!isConcreteTestNameSelector(nameValue)) return undefined;
        testNames.push(nameValue);
        if (TEST_NAME_OPTIONS.has(token)) index += 1;
        continue;
      }
      const pathValue = optionValue(token, args[index + 1], TEST_PATH_OPTIONS);
      if (pathValue !== undefined) {
        if (!isFocusedTestFile(pathValue)) return undefined;
        paths.push(selectorBasename(pathValue));
        if (TEST_PATH_OPTIONS.has(token)) index += 1;
        continue;
      }
      if (token.startsWith("-")) {
        if (!token.includes("=") && !TEST_BOOLEAN_OPTIONS.has(token) && args[index + 1]?.startsWith("-") === false) {
          index += 1;
        }
        continue;
      }
    }
    if (isFocusedTestFile(token)) paths.push(selectorBasename(token));
    else if (invocation.allowsBareName && /^[A-Za-z_][A-Za-z0-9_:.-]+$/u.test(token)) paths.push(token);
  }
  if (testNames.length > 0) return testNames.length === 1 ? testNames : undefined;
  return paths.length === 1 ? paths : undefined;
}

function isConcreteTestNameSelector(value: string): boolean {
  const selector = value.trim();
  if (
    selector.length === 0 ||
    !SAFE_TEST_NAME_SELECTOR_PATTERN.test(selector) ||
    selector.replace(/\.\*/gu, "").includes("*") ||
    matchesEmptyStringOrIsInvalid(selector)
  ) {
    return false;
  }
  const alternatives = literalSelectorAlternatives(selector);
  return (
    alternatives.length > 0 &&
    alternatives.every((alternative) =>
      (alternative.match(SELECTOR_TERM_PATTERN) ?? []).some(
        (term) => !GENERIC_SELECTOR_TERMS.has(term.toLocaleLowerCase("en-US")),
      ),
    )
  );
}

function matchesEmptyStringOrIsInvalid(selector: string): boolean {
  try {
    return new RegExp(selector, "u").test("");
  } catch {
    return true;
  }
}

function literalSelectorAlternatives(selector: string): string[] {
  const alternatives = [""];
  let escaped = false;
  let inCharacterClass = false;
  for (const character of selector) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "[") {
      inCharacterClass = true;
      continue;
    }
    if (inCharacterClass) {
      if (character === "]") inCharacterClass = false;
      continue;
    }
    if (character === "|") alternatives.push("");
    else alternatives[alternatives.length - 1] += character;
  }
  return alternatives;
}

function optionValue(token: string, next: string | undefined, options: ReadonlySet<string>): string | undefined {
  if (options.has(token)) return next ?? "";
  for (const option of options) {
    if (token.startsWith(`${option}=`)) return token.slice(option.length + 1);
  }
  return undefined;
}

function isFocusedTestFile(value: string): boolean {
  return FOCUSED_TEST_FILE_PATTERN.test(value.replace(/:[0-9]+(?::[0-9]+)?$/u, ""));
}

function selectorBasename(value: string): string {
  return value
    .replace(/:[0-9]+(?::[0-9]+)?$/u, "")
    .split(/[/\\]/u)
    .at(-1)!;
}
