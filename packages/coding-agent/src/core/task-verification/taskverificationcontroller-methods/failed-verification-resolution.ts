import { GENERIC_CHECK_PATTERN } from "../constants.ts";
import { isShellTool } from "../tool-classification.ts";
import type { TaskVerificationEvidence } from "../types.ts";
import { focusedShellInvocationWords } from "./focused-shell-command.ts";
import {
  commandContainsTestInvocation,
  focusedTestInvocation,
  type TestCommandInvocation,
} from "./test-command-invocation.ts";
import { hasPositivePassingTestResult, testInvocationCovers } from "./test-invocation-selection.ts";

const PYTEST_NAME_FILTER_USAGE_ERROR_PATTERN = /(?:^|\n)\s*ERROR:\s+Wrong expression passed to ['"]-k['"](?::|\s*$)/iu;
const AFFIRMATIVE_TEST_FAILURE_PATTERN = /\bAssertionError\b|\b[1-9]\d*\s+(?:tests?\s+)?failed\b|(?:^|\n)\s*FAIL\b/iu;
const PYTEST_BOOLEAN_TERMS = new Set(["and", "not", "or"]);
const PLAIN_PYTEST_NAME_PATTERN = /^[\p{L}\p{N}\s._-]+$/u;
const SAFE_PYTEST_PRESENTATION_FLAGS = new Set([
  "-q",
  "-qq",
  "-s",
  "-v",
  "-vv",
  "-x",
  "--disable-warnings",
  "--no-header",
  "--no-summary",
]);

export function resolveLatestFailedVerificationEvidence(
  evidence: Iterable<TaskVerificationEvidence>,
  mutationRevision: number,
): TaskVerificationEvidence[] {
  const current = [...evidence].filter(
    (item) => item.mutationRevision === mutationRevision && isShellTool(item.toolName),
  );
  const latestGenericByCommand = new Map<string, TaskVerificationEvidence>();
  for (const item of current) {
    if (GENERIC_CHECK_PATTERN.test(item.descriptor)) latestGenericByCommand.set(item.descriptor, item);
  }

  const failedTests = current.filter((item, index) => {
    if (!item.isError || !commandContainsTestInvocation(item.descriptor)) return false;
    return !current.slice(index + 1).some((later) => supersedesFailedTest(later, item));
  });
  const failedGenerics = [...latestGenericByCommand.values()].filter((item) => item.isError);
  const failures = new Set([...failedTests, ...failedGenerics]);
  return current.filter((item) => failures.has(item));
}

export function isVerificationCommand(descriptor: string): boolean {
  return GENERIC_CHECK_PATTERN.test(descriptor) || commandContainsTestInvocation(descriptor);
}

function supersedesFailedTest(later: TaskVerificationEvidence, failed: TaskVerificationEvidence): boolean {
  if (later.descriptor === failed.descriptor) {
    return later.isError || hasPositivePassingTestResult(later.outputSummary);
  }
  if (later.isError || !hasPositivePassingTestResult(later.outputSummary)) return false;
  const laterInvocation = focusedTestInvocation(later.descriptor);
  const failedInvocation = focusedTestInvocation(failed.descriptor);
  return (
    laterInvocation !== undefined &&
    failedInvocation !== undefined &&
    (testInvocationCovers(laterInvocation, failedInvocation) ||
      (isDirectPytestCommand(later.descriptor) &&
        isDirectPytestCommand(failed.descriptor) &&
        PYTEST_NAME_FILTER_USAGE_ERROR_PATTERN.test(failed.outputSummary) &&
        !AFFIRMATIVE_TEST_FAILURE_PATTERN.test(failed.outputSummary) &&
        passingPythonNodeIdCoversFailedNameFilter(laterInvocation, failedInvocation)))
  );
}

function passingPythonNodeIdCoversFailedNameFilter(
  passing: TestCommandInvocation,
  failed: TestCommandInvocation,
): boolean {
  if (passing.ecosystem !== "python" || failed.ecosystem !== "python") return false;
  if (!sameStrings(passing.workingDirectories, failed.workingDirectories)) return false;
  const failedNames = optionValues(failed.args, "-k");
  const failedPaths = failed.args.filter((argument) => argument.endsWith(".py"));
  const passingNodeIds = passing.args.filter((argument) => argument.includes(".py::"));
  if (failedNames.length !== 1 || failedPaths.length !== 1 || passingNodeIds.length !== 1) return false;
  if (passing.args.filter((argument) => argument.includes(".py")).length !== 1) return false;
  const failedName = failedNames[0]!;
  const failedPath = failedPaths[0]!;
  const passingNodeId = passingNodeIds[0]!;
  const [passingPath, ...nodeParts] = passingNodeId.split("::");
  const passingName = nodeParts[0];
  return (
    nodeParts.length === 1 &&
    passingName?.startsWith("test_") === true &&
    isPlainPytestNamePhrase(failedName) &&
    normalizePath(passingPath!) === normalizePath(failedPath) &&
    normalizeTestName(passingName).replace(/^test /u, "") === normalizeTestName(failedName) &&
    hasOnlySupportedFailedPytestArgs(failed.args, failedPath, failedName) &&
    hasOnlySupportedPassingPytestArgs(passing.args, passingNodeId)
  );
}

function hasOnlySupportedFailedPytestArgs(args: readonly string[], path: string, name: string): boolean {
  let nameCount = 0;
  let pathCount = 0;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (argument === "-k") {
      if (args[index + 1] !== name) return false;
      nameCount += 1;
      index += 1;
    } else if (argument === `-k=${name}`) nameCount += 1;
    else if (argument === path) pathCount += 1;
    else if (!SAFE_PYTEST_PRESENTATION_FLAGS.has(argument)) return false;
  }
  return nameCount === 1 && pathCount === 1;
}

function hasOnlySupportedPassingPytestArgs(args: readonly string[], nodeId: string): boolean {
  let nodeIdCount = 0;
  for (const argument of args) {
    if (argument === nodeId) nodeIdCount += 1;
    else if (!SAFE_PYTEST_PRESENTATION_FLAGS.has(argument)) return false;
  }
  return nodeIdCount === 1;
}

function isDirectPytestCommand(descriptor: string): boolean {
  const words = focusedShellInvocationWords(descriptor);
  const executable = words?.[0]?.split("/").pop();
  return (
    executable === "pytest" ||
    ((executable === "python" || executable === "python3") && words?.[1] === "-m" && words[2] === "pytest")
  );
}

function isPlainPytestNamePhrase(value: string): boolean {
  if (!PLAIN_PYTEST_NAME_PATTERN.test(value)) return false;
  return !normalizeTestName(value)
    .split(" ")
    .some((word) => PYTEST_BOOLEAN_TERMS.has(word));
}

function optionValues(args: readonly string[], option: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (argument === option && args[index + 1] !== undefined) {
      values.push(args[index + 1]!);
      index += 1;
    } else if (argument.startsWith(`${option}=`)) values.push(argument.slice(option.length + 1));
  }
  return values;
}

function normalizePath(value: string): string {
  return value.replace(/^\.\//u, "").replaceAll("\\", "/");
}

function normalizeTestName(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
