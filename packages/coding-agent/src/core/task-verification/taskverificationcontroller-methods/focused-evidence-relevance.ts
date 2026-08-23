import type { TaskRequirement } from "../types.ts";

const EVIDENCE_TERM_PATTERN = /[\p{L}\p{N}]+/gu;
const GENERIC_EVIDENCE_TERM_PATTERN =
  /^(?:allow\w*|block\w*|chang\w*|deni\w*|deny\w*|ensur\w*|fail\w*|pass\w*|preserv\w*|reject\w*|remain\w*|request\w*|requir\w*)$/iu;
const EVIDENCE_STOP_WORDS = new Set([
  "acceptance",
  "behavior",
  "criterion",
  "current",
  "dedicated",
  "evidence",
  "focused",
  "invariant",
  "preserve",
  "proves",
  "reject",
  "requested",
  "requirement",
  "targeted",
  "test",
  "tests",
  "verify",
  "with",
  "without",
]);
const HIGH_RISK_DOMAINS = [
  // A completion token is an authorization capability, so its exact phrase identifies this domain without an auth prefix.
  /\b(?:access|auth\w*|completion\s+tokens?|permission\w*)\b|(?:аутентиф|авторизац|доступ)/iu,
  /\b(?:credential\w*|encrypt\w*|privacy|secret\w*)\b|(?:приват|секрет)/iu,
  /\b(?:event[-\s]?logs?|hash\w*|integrity|manifest\w*|newline[-\s]?terminat\w*|replay\w*|stream\s+versions?|tamper\w*|terminal\s+newlines?|traversal|truncat\w*)\b|(?:подмен|целостн)/iu,
  /\b(?:atomic\w*|concurr\w*|deadlock\w*|fenc\w*|lock\w*|race\w*)\b|(?:атомар|гонк|конкурент)/iu,
  /\b(?:checkpoint\w*|crash\w*|daemon\w*|lifecycle|recover\w*|restart\w*|resume\w*|shutdown\w*|sig(?:int|kill|term)|signal\w*)\b|(?:сигнал|завершен|перезапуск|демон|восстанов|чекпоинт)/iu,
  /\b(?:durab\w*|idempoten\w*|index\w*|manifest\w*|migrat\w*|persist\w*|refresh\w*|rollback\w*|transaction\w*)\b|(?:идемпотент|индекс|манифест|миграц|откат|персист|транзакц)/iu,
  /\b(?:backoff\w*|clock\w*|compensat\w*|lease\w*|retr(?:y|ies|ied|ying)|reverse[-\s]+order|schedul\w*|virtual[-\s]+time)\b/iu,
  /\b(?:deep\s+cop(?:y|ies)|immutab\w*|output\s+isolation)\b/iu,
  /\b(?:csrf|xss)\b/iu,
];
const GENERIC_SECURITY_DOMAIN = /\bsecur\w*\b|(?:безопас)/iu;
const ALL_HIGH_RISK_DOMAIN_PATTERNS = [...HIGH_RISK_DOMAINS, GENERIC_SECURITY_DOMAIN];
const QUALIFIER_CONCEPTS = [
  { id: "invalid", unsafe: new Set(["invalid"]), safe: new Set(["valid"]) },
  { id: "malformed", unsafe: new Set(["malformed"]), safe: new Set(["wellformed"]) },
  { id: "unauthenticated", unsafe: new Set(["unauthenticated"]), safe: new Set(["authenticated"]) },
  { id: "unauthorized", unsafe: new Set(["unauthorized"]), safe: new Set(["authorized"]) },
  {
    id: "counterfeit",
    unsafe: new Set(["counterfeit", "counterfeited", "counterfeiting"]),
    safe: new Set(["authentic", "genuine"]),
  },
  {
    id: "forged",
    unsafe: new Set(["forge", "forged", "forging"]),
    safe: new Set(["authentic", "genuine"]),
  },
  { id: "absent", unsafe: new Set(["absent"]), safe: new Set(["present"]) },
  { id: "missing", unsafe: new Set(["missing"]), safe: new Set(["present"]) },
  {
    id: "omitted",
    unsafe: new Set(["omit", "omits", "omitted", "omitting"]),
    safe: new Set(["provided"]),
  },
  {
    id: "expired",
    unsafe: new Set(["expire", "expired", "expires", "expiring"]),
    safe: new Set(["unexpired"]),
  },
  {
    id: "revoked",
    unsafe: new Set(["revoke", "revoked", "revokes", "revoking"]),
    safe: new Set(["unrevoked"]),
  },
];
const QUALIFIER_TERMS = new Set([
  ...QUALIFIER_CONCEPTS.flatMap(({ unsafe, safe }) => [...unsafe, ...safe]),
  "formed",
  "well",
]);
const QUALIFIER_NEGATIONS = new Set(["never", "non", "not"]);
const QUALIFIER_NEGATION_BRIDGES = new Set(["be", "been", "being", "considered", "deemed"]);
const AMBIGUOUS_QUALIFIER = "ambiguous";
const BEHAVIOR_FAMILIES = [
  /^(?:accept(?:s|ed|ing)?|allow(?:s|ed|ing)?|permit(?:s|ted|ting)?)$/iu,
  /^(?:block(?:s|ed|ing)?|denied|denies|deny|denying|forbid(?:s|den|ding)?|prevent(?:s|ed|ing)?|refus(?:e|es|ed|ing)|reject(?:s|ed|ing)?|throw(?:s|ing)?|threw|thrown)$/iu,
  /^(?:audit(?:s|ed|ing)?|log(?:s|ged|ging)?|metric|metrics|record(?:s|ed|ing)?|report(?:s|ed|ing)?|telemetry|trace(?:s|d|ing)?)$/iu,
  /^(?:display(?:s|ed|ing)?|format(?:s|ted|ting)?|preview(?:s|ed|ing)?|render(?:s|ed|ing)?|show(?:s|ed|ing|n)?)$/iu,
  /^(?:preserv(?:e|es|ed|ing)|persist(?:s|ed|ing)?|recover(?:s|ed|ing|y)?|restor(?:e|es|ed|ing)|retain(?:s|ed|ing)?|resum(?:e|es|ed|ing))$|\broll(?:s|ed|ing)?\s+back\b/iu,
  /^(?:check(?:s|ed|ing)?|validat(?:e|es|ed|ing|ion)|verif(?:y|ies|ied|ying|ication))$/iu,
  /^(?:append(?:s|ed|ing)?|creat(?:e|es|ed|ing)|delet(?:e|es|ed|ing)|migrat(?:e|es|ed|ing|ion)|remov(?:e|es|ed|ing)|rotat(?:e|es|ed|ing|ion)|updat(?:e|es|ed|ing)|writ(?:e|es|ing|ten))$/iu,
  /^(?:decrypt(?:s|ed|ing)?|encrypt(?:s|ed|ing)?|mask(?:s|ed|ing)?|redact(?:s|ed|ing)?)$/iu,
  /^(?:return(?:s|ed|ing)?)$/iu,
];

export function evidenceMatchesRequirement(requirement: TaskRequirement, selectors: readonly string[]): boolean {
  const requirementText = `${requirement.text}\n${requirement.acceptanceCriterion}`;
  const selectorText = selectors.join("\n");
  const requirementDomains = domainFamilies(requirementText);
  const selectorDomains = domainFamilies(selectorText);
  if (requirementDomains.size === 0 || !hasFamilyCoverage(requirementDomains, selectorDomains)) return false;
  const requirementBehaviors = semanticFamilies(requirement.acceptanceCriterion, BEHAVIOR_FAMILIES);
  const selectorBehaviors = semanticFamilies(selectorText, BEHAVIOR_FAMILIES);
  if (
    requirementBehaviors.size > 0 &&
    !hasBehaviorCoverage(requirementBehaviors, selectorBehaviors, requirementText, selectorText)
  ) {
    return false;
  }
  const requirementQualifiers = qualifierPolarities(requirementText);
  const selectorQualifiers = qualifierPolarities(selectorText);
  if (!hasQualifierCoverage(requirementQualifiers, selectorQualifiers)) return false;

  const requirementTerms = new Set(relevantTerms(requirementText));
  if (requirementTerms.size === 0) return true;
  const overlap = new Set(relevantTerms(selectorText).filter((term) => requirementTerms.has(term)));
  return overlap.size >= Math.min(2, requirementTerms.size);
}

function domainFamilies(value: string): Set<number> {
  const specific = semanticFamilies(value, HIGH_RISK_DOMAINS);
  const normalized = normalizedTerms(value).join(" ");
  if (/\broll(?:ed|s)? back\b/u.test(normalized)) specific.add(5);
  if (/\bbatch\b[\s\S]*\broll(?:ed|s)? back\b|\broll(?:ed|s)? back\b[\s\S]*\bbatch\b/u.test(normalized)) {
    specific.add(3);
  }
  if (specific.size > 0) return specific;
  return GENERIC_SECURITY_DOMAIN.test(value) ? new Set([HIGH_RISK_DOMAINS.length]) : new Set();
}

function semanticFamilies(value: string, patterns: readonly RegExp[]): Set<number> {
  const terms = normalizedTerms(value);
  const normalized = terms.join(" ");
  return new Set(
    patterns.flatMap((pattern, index) =>
      pattern.test(normalized) || terms.some((term) => pattern.test(term)) ? [index] : [],
    ),
  );
}

function hasFamilyCoverage(requirementFamilies: ReadonlySet<number>, selectorFamilies: ReadonlySet<number>): boolean {
  return [...requirementFamilies].every((family) => selectorFamilies.has(family));
}

function hasBehaviorCoverage(
  requirementFamilies: ReadonlySet<number>,
  selectorFamilies: ReadonlySet<number>,
  requirementText: string,
  selectorText: string,
): boolean {
  const rejectionFamily = 1;
  const validationFamily = 5;
  return [...requirementFamilies].every(
    (family) =>
      selectorFamilies.has(family) ||
      (family === validationFamily &&
        selectorFamilies.has(rejectionFamily) &&
        hasUnsafeQualifier(requirementText) &&
        hasUnsafeQualifier(selectorText)),
  );
}

function hasUnsafeQualifier(value: string): boolean {
  return [...qualifierPolarities(value)].some((qualifier) => qualifier.endsWith(":unsafe"));
}

function qualifierPolarities(value: string): Set<string> {
  const terms = normalizedQualifierTerms(value);
  const qualifiers = new Set<string>();
  for (let index = 0; index < terms.length; index++) {
    const term = terms[index]!;
    for (const definition of QUALIFIER_CONCEPTS) {
      const unsafe = definition.unsafe.has(term);
      if (!unsafe && !definition.safe.has(term)) continue;
      const negation = qualifierNegation(terms, index);
      if (negation === "ambiguous") {
        qualifiers.add(AMBIGUOUS_QUALIFIER);
        continue;
      }
      const polarity = negation === "negated" ? !unsafe : unsafe;
      qualifiers.add(`${definition.id}:${polarity ? "unsafe" : "safe"}`);
    }
  }
  return qualifiers;
}

function normalizedQualifierTerms(value: string): string[] {
  const terms = normalizedTerms(value);
  const combined: string[] = [];
  for (let index = 0; index < terms.length; index++) {
    if (terms[index] === "well" && terms[index + 1] === "formed") {
      combined.push("wellformed");
      index += 1;
    } else {
      combined.push(terms[index]!);
    }
  }
  return combined;
}

function qualifierNegation(terms: readonly string[], qualifierIndex: number): "none" | "negated" | "ambiguous" {
  let index = qualifierIndex - 1;
  let negations = 0;
  while (index >= 0) {
    if (QUALIFIER_NEGATION_BRIDGES.has(terms[index]!)) {
      index -= 1;
      continue;
    }
    if (!QUALIFIER_NEGATIONS.has(terms[index]!)) break;
    negations += 1;
    index -= 1;
  }
  if (negations > 1) return "ambiguous";
  return negations === 1 ? "negated" : "none";
}

function hasQualifierCoverage(requirement: ReadonlySet<string>, selector: ReadonlySet<string>): boolean {
  if (requirement.has(AMBIGUOUS_QUALIFIER) || selector.has(AMBIGUOUS_QUALIFIER)) return false;
  if (![...requirement].every((qualifier) => selector.has(qualifier))) return false;
  for (const concept of QUALIFIER_CONCEPTS) {
    const unsafe = `${concept.id}:unsafe`;
    const safe = `${concept.id}:safe`;
    if (requirement.has(unsafe) !== requirement.has(safe) && selector.has(unsafe) && selector.has(safe)) return false;
  }
  return true;
}

function relevantTerms(value: string): string[] {
  return normalizedTerms(value).filter(
    (term) =>
      term.length >= 4 &&
      !EVIDENCE_STOP_WORDS.has(term) &&
      !ALL_HIGH_RISK_DOMAIN_PATTERNS.some((pattern) => pattern.test(term)) &&
      !GENERIC_EVIDENCE_TERM_PATTERN.test(term) &&
      !QUALIFIER_TERMS.has(term) &&
      !BEHAVIOR_FAMILIES.some((pattern) => pattern.test(term)),
  );
}

function normalizedTerms(value: string): string[] {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").match(EVIDENCE_TERM_PATTERN) ?? [];
}
