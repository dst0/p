import { normalizeRule, tokenize } from "./project-rule-text-analysis.ts";

export interface PrecomputedRule {
  isNever: boolean;
  isAlways: boolean;
  terms: string[];
  termSet: Set<string>;
}

export function precomputeRule(text: string): PrecomputedRule {
  const terms = tokenize(normalizeRule(text)).filter((term) => term.length > 3);
  return {
    isNever: /\b(never|do not|don't|cannot)\b/i.test(text),
    isAlways: /\b(always|must|required)\b/i.test(text),
    terms,
    termSet: new Set(terms),
  };
}

export function rulesConflict(a: PrecomputedRule, b: PrecomputedRule): boolean {
  if (a.isNever === b.isNever || a.isAlways === b.isAlways) return false;
  let overlap = 0;
  for (const term of b.terms) {
    if (!a.termSet.has(term)) continue;
    overlap++;
    if (overlap >= 3) return true;
  }
  return false;
}
