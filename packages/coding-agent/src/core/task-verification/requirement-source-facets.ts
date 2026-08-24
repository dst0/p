import type { RequirementSourceClause } from "./requirement-source-clauses.ts";

export interface RequirementSourceFacet {
  id: string;
  sourceClauseId: string;
  text: string;
  kind: "success_outcome" | "failure_preservation";
  branch: "success" | "failure";
  requiredConcepts: string[];
  behaviorAnchors: string[];
  qualifiers: string[];
  origin: "source_span" | "derived_atomicity";
}

const EXPLICIT_ATOMIC_ALTERNATIVE =
  /^(?<context>[\s\S]*?\batomic\b[\s\S]*?):\s*either\s+(?<success>[\s\S]+?)\s*,\s*or\s+(?<failure>[\s\S]+?)[.!]?$/iu;
const ORDERED_COMMIT = /^all\s+(?<subjects>[\s\S]+?)\s+(?<behavior>commit(?:s|ted|ting)?\s+in\s+order)$/iu;
const STATE_PRESERVATION = /^no\s+observable\s+state\s+changes?$/iu;
const COMMAND_SUBJECT = /^commands?$/iu;
const IDEMPOTENCY_SUBJECT = /^idempotency\s+records?$/iu;

export function requirementSourceFacets(clause: RequirementSourceClause): RequirementSourceFacet[] {
  const alternative = clause.text.trim().match(EXPLICIT_ATOMIC_ALTERNATIVE);
  if (!alternative?.groups) return [];
  const success = alternative.groups.success!.trim().match(ORDERED_COMMIT);
  const failure = alternative.groups.failure!.trim();
  if (!success?.groups || !STATE_PRESERVATION.test(failure)) return [];
  const subjects = success.groups.subjects!.split(/\s+and\s+/iu).map((subject) => subject.trim());
  if (subjects.length !== 2 || !COMMAND_SUBJECT.test(subjects[0]!) || !IDEMPOTENCY_SUBJECT.test(subjects[1]!)) {
    return [];
  }
  const context = alternative.groups.context!.trim();
  const behavior = success.groups.behavior!.trim();
  const sharedQualifiers = allSkuQualifier(context);
  return [
    facet(
      clause,
      1,
      `On the successful commit branch, all commands ${behavior} ${qualifierSuffix(sharedQualifiers)}.`,
      "success_outcome",
      "success",
      ["command"],
      ["commit_in_order"],
      [...sharedQualifiers, "all commands"],
    ),
    facet(
      clause,
      2,
      `On the successful commit branch, all idempotency records ${behavior} ${qualifierSuffix(sharedQualifiers)}.`,
      "success_outcome",
      "success",
      ["idempotency record"],
      ["commit_in_order"],
      [...sharedQualifiers, "all idempotency records"],
    ),
    facet(
      clause,
      3,
      `On the failed no-commit branch, ${failure} ${qualifierSuffix(sharedQualifiers)}.`,
      "failure_preservation",
      "failure",
      ["state"],
      ["preserve_state"],
      sharedQualifiers,
    ),
    facet(
      clause,
      4,
      `On the failed no-commit branch, no idempotency record commits ${qualifierSuffix(sharedQualifiers)}.`,
      "failure_preservation",
      "failure",
      ["idempotency record"],
      ["do_not_commit"],
      sharedQualifiers,
      "derived_atomicity",
    ),
  ];
}

export function requirementFacetConstraintError(
  facet: RequirementSourceFacet,
  requirement: string,
): string | undefined {
  const missingBranch = branchCovered(facet.branch, requirement) ? [] : [`branch ${facet.branch}`];
  const missingConcepts = facet.requiredConcepts.filter((concept) => !conceptCovered(concept, requirement));
  const missingBehaviors = facet.behaviorAnchors.filter((anchor) => !boundBehaviorCovered(facet, anchor, requirement));
  const missingQualifiers = facet.qualifiers.filter((qualifier) => !qualifierCovered(facet, qualifier, requirement));
  const missing = [
    ...missingBranch,
    ...missingConcepts.map((concept) => `concept ${concept}`),
    ...missingBehaviors.map(
      (behavior) => `bound behavior ${behavior} for ${facet.requiredConcepts.join(" and ") || "facet subject"}`,
    ),
    ...missingQualifiers.map((qualifier) => `qualifier ${qualifier}`),
  ];
  if (missing.length === 0 && !facetPropositionCovered(facet, requirement)) {
    missing.push("branch, subject-bound behavior, and qualifiers in one local proposition");
  }
  return missing.length > 0 ? `Source facet ${facet.id} is missing ${missing.join(", ")}.` : undefined;
}

function facet(
  clause: RequirementSourceClause,
  offset: number,
  text: string,
  kind: RequirementSourceFacet["kind"],
  branch: RequirementSourceFacet["branch"],
  requiredConcepts: string[],
  behaviorAnchors: string[],
  qualifiers: string[],
  origin: RequirementSourceFacet["origin"] = "source_span",
): RequirementSourceFacet {
  return {
    id: `${clause.id}-F${offset}`,
    sourceClauseId: clause.id,
    text,
    kind,
    branch,
    requiredConcepts,
    behaviorAnchors,
    qualifiers,
    origin,
  };
}

function allSkuQualifier(context: string): string[] {
  return /\ball\s+SKUs?\b/iu.test(context) ? ["all SKUs"] : [];
}

function qualifierSuffix(qualifiers: readonly string[]): string {
  return qualifiers.includes("all SKUs") ? "across all SKUs" : "";
}

function conceptCovered(concept: string, requirement: string): boolean {
  if (concept === "command") return /\bcommands?\b(?![-\s]+ids?\b)/iu.test(requirement);
  if (concept === "idempotency record") return /\bidempoten\w*\s+records?\b/iu.test(requirement);
  return concept === "state" ? /\bstate\b/iu.test(requirement) : false;
}

function branchCovered(branch: RequirementSourceFacet["branch"], requirement: string): boolean {
  if (branch === "failure") {
    return /\b(?:fail(?:ed|ing|ure|s)?|no[-\s]?commit\s+branch|does\s+not\s+commit)\b/iu.test(requirement);
  }
  if (/\b(?:success(?:ful(?:ly)?|es)?|succeed\w*)\b/iu.test(requirement)) return true;
  if (/\b(?:fail(?:ed|ing|ure|s)?|no[-\s]?commit)\b/iu.test(requirement)) return false;
  return /\bcommit(?:ted)?\s+branch\b/iu.test(requirement);
}

function facetPropositionCovered(facet: RequirementSourceFacet, requirement: string): boolean {
  return requirement
    .split(/[.;\n]+/u)
    .map((proposition) => proposition.trim())
    .filter(Boolean)
    .some(
      (proposition) =>
        branchCovered(facet.branch, proposition) &&
        facet.requiredConcepts.every((concept) => conceptCovered(concept, proposition)) &&
        facet.behaviorAnchors.every((anchor) => boundBehaviorCovered(facet, anchor, proposition)) &&
        facet.qualifiers.every((qualifier) => qualifierCovered(facet, qualifier, proposition)),
    );
}

function boundBehaviorCovered(facet: RequirementSourceFacet, anchor: string, requirement: string): boolean {
  if (anchor === "commit_in_order") {
    const subject = facet.requiredConcepts[0];
    if (subject === "command") {
      return /\b(?:(?:all|each|every)\s+commands?\s+commit\w*|commit\w*\s+(?:all|each|every)\s+commands?)\b[\s\S]{0,24}\b(?:in|item)\s+order\b/iu.test(
        requirement,
      );
    }
    return /\b(?:(?:all|each|every)\s+idempotency\s+records?\s+commit\w*|commit\w*\s+(?:all|each|every)\s+idempotency\s+records?)\b[\s\S]{0,24}\b(?:in|item)\s+order\b/iu.test(
      requirement,
    );
  }
  if (anchor === "preserve_state") {
    return /\b(?:no\s+(?:observable\s+)?state\s+changes?|state\s+(?:is\s+|remains?\s+)?unchanged|preserv\w*\s+(?:the\s+)?state)\b/iu.test(
      requirement,
    );
  }
  return /\b(?:no\s+idempotency\s+records?\s+(?:are\s+)?commit\w*|commit\w*\s+no\s+idempotency\s+records?|does\s+not\s+commit\s+(?:an?|any|all|each|every)?\s*idempotency\s+records?)\b/iu.test(
    requirement,
  );
}

function qualifierCovered(facet: RequirementSourceFacet, qualifier: string, requirement: string): boolean {
  if (qualifier === "all SKUs") {
    const universal = facet.branch === "failure" ? "all|any|each|every" : "all|each|every";
    return new RegExp(`\\b(?:${universal})\\s+SKUs?\\b`, "iu").test(requirement);
  }
  if (qualifier === "all commands") return /\b(?:all|each|every)\s+commands?\b/iu.test(requirement);
  return /\b(?:all|each|every)\s+idempotency\s+records?\b/iu.test(requirement);
}
