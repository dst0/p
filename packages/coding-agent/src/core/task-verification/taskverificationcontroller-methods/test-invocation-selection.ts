import type { TestCommandInvocation } from "./test-command-invocation.ts";

export interface TestInvocationSelection {
  broad: boolean;
  pathGlobs: string[];
  pathSelectors: string[];
  testNames: string[];
  vacuous: boolean;
}

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
const VACUOUS_TEST_OPTIONS = new Set(["--passWithNoTests", "--pass-with-no-tests"]);
const GENERIC_SELECTOR_TERMS = new Set(["all", "and", "any", "false", "not", "or", "test", "tests", "true"]);
const SELECTOR_TERM_PATTERN = /[\p{L}\p{N}]{3,}/gu;
const SAFE_TEST_NAME_SELECTOR_PATTERN = /^[\p{L}\p{N}\s._:/=,'^$|*-]+$/u;
const FOCUSED_TEST_FILE_PATTERN =
  /(?:^|\/)(?:test_[^/]+\.py|[^/]+_test\.go|[^/]+\.(?:test|spec)\.[cm]?[jt]sx?|tests?\/[^/]+\.rs)(?::[^\s]+)?$/iu;
const POSITIVE_TEST_RESULT_PATTERN =
  /(?:^|\s)---\s+PASS:|\btest result:\s+ok\b[\s\S]*\b[1-9]\d*\s+passed\b|\btests?\s*:?\s*[1-9]\d*\s+passed\b|\b[1-9]\d*\s+(?:tests?\s+)?passed\b|(?:^|\s)(?:#|ℹ)\s*pass\s+[1-9]\d*\b/iu;
const FAILED_TEST_RESULT_PATTERN =
  /(?:^|\s)---\s+FAIL:|(?:^|\n)\s*(?:FAIL\b|not ok\b)|\btest result:\s+FAILED\b|\b(?:test files?|tests?)\s*:?\s*[1-9]\d*\s+failed\b|\bfailed tests?\s*:?\s*[1-9]\d*\b|\b[1-9]\d*\s+(?:tests?\s+)?failed\b|(?:^|\s)ℹ\s*fail\s+[1-9]\d*\b|\bfail(?:ed)?\s*:?\s*[1-9]\d*\b|\b(?:AssertionError|Unhandled Error):/iu;
const RUNTIME_ASSERTION_FAILURE_PATTERN = /(?:^|\n)\s*Assertion failed(?:\s*:|\s*$)/iu;

export function testInvocationSelection(invocation: TestCommandInvocation): TestInvocationSelection {
  const testNames: string[] = [];
  const pathGlobs: string[] = [];
  const pathSelectors: string[] = [];
  const bareSelectors: string[] = [];
  let positionalOnly = false;
  let unresolved = invocation.scopeNarrowed === true;
  for (let index = 0; index < invocation.args.length; index++) {
    const token = invocation.args[index]!;
    if (token === "--") {
      positionalOnly = true;
      continue;
    }
    if (!positionalOnly) {
      if (matchesOption(token, VACUOUS_TEST_OPTIONS)) {
        return { broad: false, pathGlobs: [], pathSelectors: [], testNames: [], vacuous: true };
      }
      const nameValue = optionValue(token, invocation.args[index + 1], TEST_NAME_OPTIONS);
      if (nameValue !== undefined) {
        if (!isConcreteTestNameSelector(nameValue)) unresolved = true;
        else testNames.push(nameValue);
        if (TEST_NAME_OPTIONS.has(token)) index += 1;
        continue;
      }
      const pathValue = optionValue(token, invocation.args[index + 1], TEST_PATH_OPTIONS);
      if (pathValue !== undefined) {
        if (!isFocusedTestFile(pathValue)) unresolved = true;
        else pathSelectors.push(normalizeSelectorPath(pathValue));
        if (TEST_PATH_OPTIONS.has(token)) index += 1;
        continue;
      }
      if (token.startsWith("-")) {
        if (!TEST_BOOLEAN_OPTIONS.has(token)) unresolved = true;
        if (!token.includes("=") && !TEST_BOOLEAN_OPTIONS.has(token) && !invocation.args[index + 1]?.startsWith("-")) {
          index += 1;
        }
        continue;
      }
    }
    if (isFocusedTestFile(token)) pathSelectors.push(normalizeSelectorPath(token));
    else if (isSafeTestFileGlob(token)) pathGlobs.push(normalizeSelectorPath(token));
    else if (invocation.allowsBareName && /^[A-Za-z_][A-Za-z0-9_:.-]+$/u.test(token)) bareSelectors.push(token);
    else unresolved = true;
  }
  const focusedSelectors = testNames.length > 0 ? testNames : bareSelectors;
  return {
    broad: !unresolved && focusedSelectors.length === 0 && pathSelectors.length === 0 && pathGlobs.length === 0,
    pathGlobs,
    pathSelectors,
    testNames: focusedSelectors,
    vacuous: unresolved,
  };
}

export function testInvocationCovers(covering: TestCommandInvocation, covered: TestCommandInvocation): boolean {
  const coveringSelection = testInvocationSelection(covering);
  const coveredSelection = testInvocationSelection(covered);
  if (covering.ecosystem !== covered.ecosystem) return false;
  if (!sameOrderedStrings(covering.workingDirectories, covered.workingDirectories)) return false;
  if (coveringSelection.vacuous || coveredSelection.vacuous) return false;
  if (coveringSelection.broad) return true;
  if (
    coveringSelection.testNames.length > 0 &&
    !sameSelectors(coveringSelection.testNames, coveredSelection.testNames)
  ) {
    return false;
  }
  if (coveredSelection.pathSelectors.length === 0 || coveredSelection.pathGlobs.length > 0) return false;
  return coveredSelection.pathSelectors.every(
    (path) =>
      coveringSelection.pathSelectors.includes(path) ||
      coveringSelection.pathGlobs.some((glob) => testPathMatchesGlob(path, glob)),
  );
}

function sameOrderedStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameSelectors(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((selector) => right.includes(selector)) &&
    right.every((selector) => left.includes(selector))
  );
}

export function focusedRequirementSelectors(invocation: TestCommandInvocation): string[] | undefined {
  const selection = detailedSelection(invocation);
  if (selection.vacuous) return undefined;
  if (selection.testNames.length > 0) return selection.testNames.length === 1 ? selection.testNames : undefined;
  const selectors =
    selection.bareSelectors.length > 0 ? selection.bareSelectors : selection.pathSelectors.map(basename);
  return selectors.length === 1 ? selectors : undefined;
}

export function hasPositivePassingTestResult(output: string): boolean {
  const withoutContainerSummaries = output.replace(
    /\btest (?:files?|suites?)\s*:?\s*\d+\s+passed(?:\s*\(\d+\))?/giu,
    "",
  );
  return (
    POSITIVE_TEST_RESULT_PATTERN.test(withoutContainerSummaries) &&
    !FAILED_TEST_RESULT_PATTERN.test(output) &&
    !hasRuntimeAssertionFailure(output)
  );
}

export function hasRuntimeAssertionFailure(output: string): boolean {
  return RUNTIME_ASSERTION_FAILURE_PATTERN.test(output);
}

function detailedSelection(invocation: TestCommandInvocation): {
  bareSelectors: string[];
  pathSelectors: string[];
  testNames: string[];
  vacuous: boolean;
} {
  const testNames: string[] = [];
  const pathSelectors: string[] = [];
  const bareSelectors: string[] = [];
  if (invocation.scopeNarrowed) return { bareSelectors, pathSelectors, testNames, vacuous: true };
  let positionalOnly = false;
  for (let index = 0; index < invocation.args.length; index++) {
    const token = invocation.args[index]!;
    if (token === "--") {
      positionalOnly = true;
      continue;
    }
    if (!positionalOnly) {
      if (matchesOption(token, VACUOUS_TEST_OPTIONS)) return { bareSelectors, pathSelectors, testNames, vacuous: true };
      const nameValue = optionValue(token, invocation.args[index + 1], TEST_NAME_OPTIONS);
      if (nameValue !== undefined) {
        if (!isConcreteTestNameSelector(nameValue))
          return { bareSelectors, pathSelectors, testNames: [], vacuous: true };
        testNames.push(nameValue);
        if (TEST_NAME_OPTIONS.has(token)) index += 1;
        continue;
      }
      const pathValue = optionValue(token, invocation.args[index + 1], TEST_PATH_OPTIONS);
      if (pathValue !== undefined) {
        if (!isFocusedTestFile(pathValue)) return { bareSelectors, pathSelectors: [], testNames, vacuous: true };
        pathSelectors.push(normalizeSelectorPath(pathValue));
        if (TEST_PATH_OPTIONS.has(token)) index += 1;
        continue;
      }
      if (token.startsWith("-")) {
        if (!TEST_BOOLEAN_OPTIONS.has(token)) return { bareSelectors, pathSelectors, testNames, vacuous: true };
        if (!token.includes("=") && !TEST_BOOLEAN_OPTIONS.has(token) && !invocation.args[index + 1]?.startsWith("-")) {
          index += 1;
        }
        continue;
      }
    }
    if (isFocusedTestFile(token)) pathSelectors.push(normalizeSelectorPath(token));
    else if (invocation.allowsBareName && /^[A-Za-z_][A-Za-z0-9_:.-]+$/u.test(token)) bareSelectors.push(token);
  }
  return { bareSelectors, pathSelectors, testNames, vacuous: false };
}

function matchesOption(token: string, options: ReadonlySet<string>): boolean {
  return options.has(token) || [...options].some((option) => token.startsWith(`${option}=`));
}

function optionValue(token: string, next: string | undefined, options: ReadonlySet<string>): string | undefined {
  if (options.has(token)) return next ?? "";
  for (const option of options) if (token.startsWith(`${option}=`)) return token.slice(option.length + 1);
  return undefined;
}

function isConcreteTestNameSelector(value: string): boolean {
  const selector = value.trim();
  if (!selector || !SAFE_TEST_NAME_SELECTOR_PATTERN.test(selector) || selector.replace(/\.\*/gu, "").includes("*")) {
    return false;
  }
  try {
    if (new RegExp(selector, "u").test("")) return false;
  } catch {
    return false;
  }
  const alternatives = literalSelectorAlternatives(selector);
  return alternatives.every((alternative) =>
    (alternative.match(SELECTOR_TERM_PATTERN) ?? []).some(
      (term) => !GENERIC_SELECTOR_TERMS.has(term.toLocaleLowerCase("en-US")),
    ),
  );
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

function isFocusedTestFile(value: string): boolean {
  const normalized = value.replace(/:[0-9]+(?::[0-9]+)?$/u, "");
  return !/[*?[\]{}!]/u.test(normalized) && FOCUSED_TEST_FILE_PATTERN.test(normalized);
}

function isSafeTestFileGlob(value: string): boolean {
  const normalized = normalizeSelectorPath(value);
  return (
    normalized.includes("*") &&
    !/[?[\]{}!]/u.test(normalized) &&
    !normalized.split("/").includes("..") &&
    /(?:^|\/)(?:tests?|__tests__)\//u.test(normalized) &&
    isFocusedTestFile(normalized.replaceAll("*", "x"))
  );
}

function testPathMatchesGlob(path: string, glob: string): boolean {
  let pattern = "^";
  for (let index = 0; index < glob.length; index++) {
    const character = glob[index]!;
    if (character !== "*") {
      pattern += /[\\^$.*+?()[\]{}|]/u.test(character) ? `\\${character}` : character;
      continue;
    }
    if (glob[index + 1] === "*") {
      pattern += ".*";
      index += 1;
    } else {
      pattern += "[^/]*";
    }
  }
  return new RegExp(`${pattern}$`, "u").test(path);
}

function normalizeSelectorPath(value: string): string {
  return value
    .replace(/^\.\//u, "")
    .replace(/:[0-9]+(?::[0-9]+)?$/u, "")
    .replaceAll("\\", "/");
}

function basename(value: string): string {
  return value.split("/").at(-1)!;
}
