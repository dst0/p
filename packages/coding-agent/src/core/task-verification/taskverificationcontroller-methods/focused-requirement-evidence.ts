import { selectorsMatchProofPolicies } from "../requirement-proof-evidence.ts";
import { evidenceHasProofWitnesses } from "../requirement-proof-witnesses.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import { isShellTool } from "../tool-classification.ts";
import type { TaskRequirement, TaskVerificationEvidence } from "../types.ts";
import { evidenceMatchesRequirement } from "./focused-evidence-relevance.ts";
import { focusedShellInvocationWords } from "./focused-shell-command.ts";

const SHELL_ASSIGNMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=/u;
const ENV_OPTIONS_WITH_VALUE = new Set(["-a", "--argv0", "-C", "--chdir", "-u", "--unset"]);
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

interface TestInvocation {
  args: string[];
  allowsBareName: boolean;
}

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
  const words = focusedInvocationWords(command);
  if (words === undefined) return undefined;
  const nested = leanContextCommand(words);
  if (nested !== undefined) return depth < 2 ? focusedTestSelectors(nested, depth + 1) : undefined;
  const invocation = testInvocation(words);
  return invocation === undefined ? undefined : getFocusedTestSelectors(invocation);
}

function focusedInvocationWords(command: string): string[] | undefined {
  const words = focusedShellInvocationWords(command);
  return words === undefined ? undefined : unwrapShellWrappers(words);
}

function unwrapShellWrappers(words: readonly string[]): string[] {
  let index = 0;
  while (SHELL_ASSIGNMENT_PATTERN.test(words[index] ?? "")) index += 1;
  while (index < words.length) {
    const executable = words[index]?.split("/").pop();
    if (executable === "command") {
      index += 1;
      while (words[index]?.startsWith("-") && words[index] !== "--") index += 1;
      if (words[index] === "--") index += 1;
    } else if (executable === "env") {
      index += 1;
      while (index < words.length) {
        const word = words[index]!;
        if (word === "--") {
          index += 1;
          break;
        }
        if (ENV_OPTIONS_WITH_VALUE.has(word)) index += 2;
        else if (word.startsWith("-") || SHELL_ASSIGNMENT_PATTERN.test(word)) index += 1;
        else break;
      }
    } else {
      break;
    }
    while (SHELL_ASSIGNMENT_PATTERN.test(words[index] ?? "")) index += 1;
  }
  return words.slice(index);
}

function leanContextCommand(words: readonly string[]): string | undefined {
  if (words[0]?.split("/").pop() !== "lean-ctx") return undefined;
  const commandIndex = words.findIndex((word) => word === "-c" || word === "--command");
  return commandIndex >= 0 ? words[commandIndex + 1] : undefined;
}

function testInvocation(words: readonly string[]): TestInvocation | undefined {
  const executable = words[0]?.split("/").pop();
  if (executable === "vitest" || executable === "jest" || executable === "pytest" || executable === "test.sh") {
    return { args: testRunnerArgs(words.slice(1)), allowsBareName: false };
  }
  if (executable === "cargo" || executable === "go") {
    return words[1] === "test" ? { args: words.slice(2), allowsBareName: executable === "cargo" } : undefined;
  }
  if (executable === "bun" || executable === "yarn" || executable === "pnpm") {
    if (words[1] === "test") return { args: packageRunnerArgs(words.slice(2)), allowsBareName: false };
    if (words[1] === "run" && words[2]?.startsWith("test")) {
      return { args: packageRunnerArgs(words.slice(3)), allowsBareName: false };
    }
    return undefined;
  }
  if (executable === "npm") {
    if (words[1] === "test") return { args: packageRunnerArgs(words.slice(2)), allowsBareName: false };
    if (words[1] === "run" && words[2]?.startsWith("test")) {
      return { args: packageRunnerArgs(words.slice(3)), allowsBareName: false };
    }
    if (words[1] === "exec" && ["vitest", "jest"].includes(words[2] ?? "")) {
      return { args: testRunnerArgs(packageRunnerArgs(words.slice(3))), allowsBareName: false };
    }
    return undefined;
  }
  if (executable === "npx" && ["vitest", "jest"].includes(words[1] ?? "")) {
    return { args: testRunnerArgs(words.slice(2)), allowsBareName: false };
  }
  if (executable === "python" || executable === "python3") {
    const moduleIndex = words.findIndex((word, index) => index > 0 && word === "-m" && words[index + 1] === "pytest");
    return moduleIndex >= 0 ? { args: words.slice(moduleIndex + 2), allowsBareName: false } : undefined;
  }
  if (executable !== "node") return undefined;
  const nodeTestIndex = words.indexOf("--test");
  if (nodeTestIndex >= 0) return { args: words.slice(nodeTestIndex + 1), allowsBareName: false };
  const cliIndex = words.findIndex((word) => /(?:^|\/)(?:vitest|jest)(?:\/|\.js$)/u.test(word));
  return cliIndex >= 0 ? { args: testRunnerArgs(words.slice(cliIndex + 1)), allowsBareName: false } : undefined;
}

function packageRunnerArgs(args: readonly string[]): string[] {
  return args[0] === "--" ? args.slice(1) : [...args];
}

function testRunnerArgs(args: readonly string[]): string[] {
  const normalized = packageRunnerArgs(args);
  return normalized[0] === "run" ? normalized.slice(1) : normalized;
}

function getFocusedTestSelectors(invocation: TestInvocation): string[] | undefined {
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
