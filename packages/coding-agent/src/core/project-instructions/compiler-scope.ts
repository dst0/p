import { getProjectInstructionConstraintSourceText } from "./compiler-source-units.ts";
import type { ProjectInstructionConstraintInput } from "./types.ts";

const PROTECTED_DATA_PATTERN =
  /\b(?:api[- ]?keys?|credentials?|customer data|personal data|private keys?|secrets?|sensitive (?:data|information)|(?:access|auth(?:entication)?|bearer|credential|secret) tokens?)\b/iu;
const PROTECTION_DIRECTIVE_PATTERN = /\b(?:be (?:very )?careful|do not|don't|must not|never|protect|redact)\b/iu;
const EXPLICIT_ACTIVITY_SCOPE_PATTERN = /\b(?:after|before|during|if|prior\s+to|when|whenever|while)\b/iu;
const BROAD_PROTECTION_HEADING_TERMS = new Set([
  "agent",
  "api",
  "access",
  "auth",
  "authentication",
  "behavior",
  "best",
  "controls",
  "credential",
  "credentials",
  "cybersecurity",
  "data",
  "development",
  "general",
  "global",
  "information",
  "instruction",
  "instructions",
  "key",
  "keys",
  "policy",
  "practice",
  "practices",
  "privacy",
  "project",
  "protection",
  "required",
  "requirements",
  "rule",
  "rules",
  "safety",
  "security",
  "secret",
  "secrets",
  "sensitive",
  "token",
  "tokens",
  "universal",
]);

export function isUnmistakablyGlobalConstraint(content: string): boolean {
  const activityScopeText = content.replace(/\beven\s+if\b/giu, "");
  return (
    /\balways[- ]on\b/iu.test(content) ||
    (!EXPLICIT_ACTIVITY_SCOPE_PATTERN.test(activityScopeText) &&
      /\b(?:across\s+)?(?:all|every)\s+(?:user\s+)?(?:messages?|replies|requests?|responses?|tasks?|turns?)\b/iu.test(
        content,
      ))
  );
}

export function requiresConservativeAlwaysOn(constraint: ProjectInstructionConstraintInput): boolean {
  const sourceText = getProjectInstructionConstraintSourceText(constraint);
  return (
    constraint.kind === "orphan-heading" ||
    isUnmistakablyGlobalConstraint(sourceText) ||
    isUnqualifiedCrossCuttingDataProtection(constraint) ||
    [...sourceText].some((character) => /\p{L}/u.test(character) && !/[A-Za-z]/u.test(character))
  );
}

function isUnqualifiedCrossCuttingDataProtection(constraint: ProjectInstructionConstraintInput): boolean {
  const activityScopeText = constraint.content.replace(/\beven\s+if\b/giu, "");
  if (
    !PROTECTED_DATA_PATTERN.test(constraint.content) ||
    !PROTECTION_DIRECTIVE_PATTERN.test(constraint.content) ||
    EXPLICIT_ACTIVITY_SCOPE_PATTERN.test(activityScopeText)
  ) {
    return false;
  }
  return constraint.headingContext.every(({ content }) => {
    const terms = content.toLocaleLowerCase("en-US").match(/[a-z]+/gu) ?? [];
    return terms.length > 0 && terms.every((term) => BROAD_PROTECTION_HEADING_TERMS.has(term));
  });
}
