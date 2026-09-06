import { HIGH_RISK_PATTERN, HIGH_RISK_REQUIREMENT_PATTERN } from "./constants.ts";
import {
  hasRollbackOperationSemantics,
  withoutRollbackTerms,
  withoutStaticRollbackPropertyValues,
} from "./requirement-rollback-semantics.ts";
import type { RequirementSourceClause } from "./requirement-source-clauses.ts";
import { focusedShellInvocation } from "./taskverificationcontroller-methods/focused-shell-command.ts";
import { focusedTestInvocation } from "./taskverificationcontroller-methods/test-command-invocation.ts";
import type { RequirementType } from "./types.ts";

const PROCEDURAL_RECOVERY_FALLBACK_PATTERN = /\brecover(?:s|ed|ing)?\s+(?:by|using|with)\s+([^,.!?;\n]+)/giu;
const LEADING_RECOVERY_FALLBACK_PATTERN =
  /\bas\s+(?:(?:a|the)\s+)?(?:recovery(?:\s+fallback)?|fallback\s+for\s+recovery)\b\s*(?:,|:)?\s*([^,.!?;\n]+)/giu;
const TEST_COMMAND_AS_RECOVERY_FALLBACK_PATTERN =
  /(?:^|[,.!?;\n]\s*)([^,.!?;\n]+?)\s+as\s+(?:(?:a|the)\s+)?(?:recovery(?:\s+fallback)?|fallback\s+for\s+recovery)\b(?:\s+(?:to\s+(?:run|execute)|for)\s+[^,.!?;\n]*?\btests?)?/gimu;
const RECOVERY_FALLBACK_RUNS_TEST_PATTERN = /\brecovery\s+fallback\s+(?:uses|runs)\s+([^,.!?;\n]+)/giu;
const LEADING_CONDITIONAL_COMMAND_PATTERN = /^((?:if|when)\b.*?(?:\bthen|:))\s+(.+)$/iu;
const CONDITIONAL_TEST_AVAILABILITY_PATTERN =
  /^((?:if|when)\s+)(.+?)(\s+(?:(?:is|are|was|were)\s+(?:unavailable|missing|absent|unsupported|not\s+available)|fails?)(?:\s+then|:))$/iu;
const INLINE_CODE_SPAN_PATTERN = /`([^`\n]+)`/gu;
const GENERIC_TEST_SUBJECT_PATTERN =
  /\b(?:tests?|test(?::[\w:-]+)?\s+(?:command|script|suite)|typecheck\s+(?:command|script))$/iu;
const PROCEDURAL_COMMAND_BOUNDARY_PATTERN = /\s+(?=(?:after|before|when|if|while|and|then|with|without|so\s+that)\b)/iu;
const PROCEDURAL_TEST_PURPOSE_PATTERN = /\s+(?:to\s+(?:run|execute)|for)\s+[^,.!?;\n]*?\btests?\b/iu;
const PROCEDURAL_COMMAND_VERB_PATTERN =
  /^(?:please\s+)?(?:use|uses|used|using|run|runs|ran|running|rerun|reruns|reran|rerunning|execute|executes|executed|executing|invoke|invokes|invoked|invoking)\s+/iu;
const PROCEDURAL_COMMAND_PASSIVE_SUFFIX_PATTERN =
  /\s+(?:(?:(?:is|was)\s+|will\s+be\s+)?(?:executed|invoked|run|used|selected|chosen)|serves?)$/iu;
const GENERIC_VERIFICATION_COMMAND_PATTERN =
  /^(?:(?:the|a)\s+)?(?:full\s+)?(?:test|typecheck)\s+(?:command|script|suite)$/iu;
const VERIFICATION_SELECTOR_OPTIONS_WITH_VALUE = new Set([
  "-k",
  "-m",
  "-p",
  "-t",
  "--config",
  "--exclude",
  "--filter",
  "--grep",
  "--include",
  "--project",
  "--test-name-pattern",
  "--testNamePattern",
  "--testPathPattern",
]);
const PATH_LIKE_SELECTOR_PATTERN = /[\\/]|\.(?:[cm]?[jt]sx?|py|rs|go)$/iu;
const RUNTIME_STATE_INVARIANT_PATTERN =
  /\b(?:no\s+partial\s+mutation|without\s+(?:a\s+)?partial\s+mutat\w*|without\s+(?:partially\s+)?(?:mutat\w*|chang\w*)\s+(?:(?:the|all)\s+)?(?:state|data|history|logs?|positions?|versions?)|(?:preserv\w*|keep\w*|retain\w*)\s+(?:(?:the|all)\s+)?(?:state|data|history|logs?|positions?|versions?)|(?:leav\w*|keep\w*)\s+(?:(?:the|all)\s+)?(?:state|data|history|logs?|positions?|versions?)\s+(?:unchanged|intact)|(?:state|data|history|logs?|positions?|versions?)\s+(?:(?:is|are|remains?|stays?)\s+)?(?:unchanged|intact)|(?:mutat\w*|chang\w*|delet\w*|remov\w*|overwrit\w*|discard\w*|corrupt\w*|truncat\w*|advanc\w*|clear\w*)\s+(?:(?:the|all)\s+)?(?:state|data|history|logs?|positions?|versions?))\b/iu;

export interface RequirementRisk {
  highRisk: boolean;
  sourcePromptIndexes: number[];
}

export function requirementRisk(
  text: string,
  acceptanceCriterion: string,
  sourcePromptIndexes: readonly number[],
  sourceClauseIds: readonly string[],
  sourceClauses: readonly RequirementSourceClause[],
): RequirementRisk {
  const requirementText = `${text}\n${acceptanceCriterion}`;
  const sourceMatches = sourceClauses
    .filter((clause) => sourceClauseIds.includes(clause.id) && isHighRiskText(clause.text))
    .map((clause) => clause.sourcePromptIndex)
    .filter((sourceIndex) => sourcePromptIndexes.includes(sourceIndex));
  return {
    highRisk: isHighRiskText(requirementText) || sourceMatches.length > 0,
    sourcePromptIndexes: [...new Set(sourceMatches)].sort((left, right) => left - right),
  };
}

export function isProductInvariantRequirementType(type: RequirementType): boolean {
  return type !== "workflow" && type !== "verification";
}

export function hasHighRiskRequirementSemantics(value: string): boolean {
  const semanticText = withoutStaticRollbackPropertyValues(value);
  const nonRollbackText = withoutProceduralRecoveryFallbacks(withoutRollbackTerms(semanticText));
  return (
    HIGH_RISK_REQUIREMENT_PATTERN.test(nonRollbackText) ||
    hasRollbackOperationSemantics(semanticText) ||
    hasRuntimeStateSemantics(nonRollbackText)
  );
}

export function isHighRiskText(value: string): boolean {
  const semanticText = withoutStaticRollbackPropertyValues(value);
  const nonRollbackText = withoutProceduralRecoveryFallbacks(withoutRollbackTerms(semanticText));
  return HIGH_RISK_PATTERN.test(nonRollbackText) || hasHighRiskRequirementSemantics(semanticText);
}

function withoutProceduralRecoveryFallbacks(value: string): string {
  return value
    .replace(PROCEDURAL_RECOVERY_FALLBACK_PATTERN, maskProceduralCommand)
    .replace(LEADING_RECOVERY_FALLBACK_PATTERN, maskProceduralCommand)
    .replace(TEST_COMMAND_AS_RECOVERY_FALLBACK_PATTERN, maskProceduralCommand)
    .replace(RECOVERY_FALLBACK_RUNS_TEST_PATTERN, maskProceduralCommand);
}

function maskProceduralCommand(match: string, candidate: string): string {
  const trimmedCandidate = candidate.trim();
  const conditionalMatch = LEADING_CONDITIONAL_COMMAND_PATTERN.exec(trimmedCandidate);
  const condition = conditionalMatch?.[1] ?? "";
  const commandCandidate = conditionalMatch?.[2] ?? trimmedCandidate;
  const purposeMatch = PROCEDURAL_TEST_PURPOSE_PATTERN.exec(commandCandidate);
  const purposeIndex = purposeMatch?.index ?? -1;
  const commandBeforePurpose = commandCandidate.slice(0, purposeIndex < 0 ? undefined : purposeIndex);
  const purposeRemainder = purposeMatch ? commandCandidate.slice(purposeMatch.index + purposeMatch[0].length) : "";
  const boundaryIndex = commandBeforePurpose.search(PROCEDURAL_COMMAND_BOUNDARY_PATTERN);
  const command = commandBeforePurpose.slice(0, boundaryIndex < 0 ? undefined : boundaryIndex);
  const remainder = `${boundaryIndex < 0 ? "" : commandBeforePurpose.slice(boundaryIndex)}${purposeRemainder}`;
  const normalizedCommand = command
    .trim()
    .replace(PROCEDURAL_COMMAND_VERB_PATTERN, "")
    .replace(PROCEDURAL_COMMAND_PASSIVE_SUFFIX_PATTERN, "")
    .replace(/^`([^`\n]+)`$/u, "$1")
    .trim();
  if (!isVerificationCommand(normalizedCommand)) return match;
  const semanticCondition = maskProceduralAvailabilityCondition(condition);
  return ` ${semanticCondition.length > 0 ? `${semanticCondition} ` : ""}test-command fallback${remainder}`;
}

function maskProceduralAvailabilityCondition(condition: string): string {
  const availabilityMatch = CONDITIONAL_TEST_AVAILABILITY_PATTERN.exec(condition);
  if (availabilityMatch === null) return condition;
  const subject = availabilityMatch[2]!.trim();
  const normalizedSubject = subject.replace(INLINE_CODE_SPAN_PATTERN, "$1");
  if (!isVerificationCommand(normalizedSubject) && !GENERIC_TEST_SUBJECT_PATTERN.test(normalizedSubject)) {
    return condition;
  }
  return `${availabilityMatch[1]}test-command${availabilityMatch[3]}`;
}

function hasRawHighRiskSemantics(value: string): boolean {
  const semanticText = withoutStaticRollbackPropertyValues(value);
  const nonRollbackText = withoutRollbackTerms(semanticText);
  return (
    HIGH_RISK_PATTERN.test(nonRollbackText) ||
    HIGH_RISK_REQUIREMENT_PATTERN.test(nonRollbackText) ||
    hasRollbackOperationSemantics(semanticText) ||
    hasRuntimeStateSemantics(nonRollbackText)
  );
}

function isVerificationCommand(command: string): boolean {
  if (GENERIC_VERIFICATION_COMMAND_PATTERN.test(command)) return true;
  const testInvocation = focusedTestInvocation(command);
  if (testInvocation !== undefined) {
    return !hasRawHighRiskSemantics(residualVerificationArguments(testInvocation.args, testInvocation.allowsBareName));
  }
  const focusedInvocation = focusedShellInvocation(command);
  if (focusedInvocation === undefined) return false;
  const typecheckArguments = focusedTypecheckArguments(focusedInvocation.words);
  return (
    typecheckArguments !== undefined &&
    !hasRawHighRiskSemantics(residualVerificationArguments(typecheckArguments, false))
  );
}

function focusedTypecheckArguments(words: readonly string[]): string[] | undefined {
  const executable = words[0]?.split("/").pop();
  if (["bun", "npm", "pnpm", "yarn"].includes(executable ?? "")) {
    if (words[1] === "typecheck") return words.slice(2);
    if (words[1] === "run" && words[2] === "typecheck") return words.slice(3);
    if (words[1] === "exec" && words[2] === "tsc") return words.slice(3);
  }
  if ((executable === "npx" || executable === "bunx") && words[1] === "tsc") return words.slice(2);
  return executable === "tsc" ? words.slice(1) : undefined;
}

function residualVerificationArguments(args: readonly string[], allowsBareName: boolean): string {
  const residual: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (VERIFICATION_SELECTOR_OPTIONS_WITH_VALUE.has(argument)) {
      index += 1;
    } else if (!argument.startsWith("-") && !PATH_LIKE_SELECTOR_PATTERN.test(argument)) {
      residual.push(argument);
    }
  }
  if (residual.length === 1 && (allowsBareName || !/\s/u.test(residual[0]!))) return "";
  return residual.join(" ");
}

function hasRuntimeStateSemantics(value: string): boolean {
  return value.split(/[.!?;\n]+/u).some((clause) => RUNTIME_STATE_INVARIANT_PATTERN.test(clause));
}
