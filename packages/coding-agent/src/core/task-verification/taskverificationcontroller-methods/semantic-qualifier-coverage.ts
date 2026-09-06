import { isSemanticCardinalityTerm, semanticCardinalityAfter } from "./semantic-cardinality.ts";
import {
  hasGroupedQualifierCoverage,
  maximumMatchedQualifierIndexes,
  type QualifierBinding,
} from "./semantic-qualifier-matching.ts";
import { recognizeQualifier, SEMANTIC_QUALIFIER_TERMS } from "./semantic-qualifier-recognition.ts";
import { normalizedQualifierTerms, semanticQualifierSegments } from "./semantic-qualifier-text.ts";
import { strictNormativeSourceSegments } from "./semantic-source-clauses.ts";

const ANCHOR_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "atomically",
  "be",
  "been",
  "being",
  "emits",
  "for",
  "from",
  "in",
  "is",
  "its",
  "must",
  "of",
  "or",
  "our",
  "starts",
  "than",
  "that",
  "the",
  "their",
  "these",
  "this",
  "those",
  "to",
  "with",
  "writes",
  "your",
]);
const ORDER_PREDICATE_TERMS = new Set([
  "emit",
  "emits",
  "emitted",
  "emitting",
  "handle",
  "handled",
  "handles",
  "next",
  "process",
  "processed",
  "processes",
  "preserve",
  "preserves",
  "preserved",
  "preserving",
]);
const FORWARD_ANCHOR_BOUNDARIES = new Set([
  "and",
  "are",
  "can",
  "could",
  "ends",
  "fails",
  "has",
  "includes",
  "is",
  "may",
  "might",
  "must",
  "or",
  "produces",
  "returns",
  "shall",
  "should",
  "succeeds",
  "successfully",
  "will",
  "would",
]);
const FORWARD_SUBJECT_BOUNDARIES = new Set([
  ...FORWARD_ANCHOR_BOUNDARIES,
  "containing",
  "from",
  "using",
  "via",
  "where",
  "which",
  "with",
]);

export { SEMANTIC_QUALIFIER_TERMS } from "./semantic-qualifier-recognition.ts";

export interface SemanticQualifierGap {
  qualifier: QualifierBinding["id"];
  anchors: string[];
  values: string[];
}

export function hasSemanticQualifierCoverage(requirement: string, selector: string): boolean {
  const requiredGroups = qualifierBindingGroups(requirement);
  const selected = qualifierBindings(selector);
  return hasGroupedQualifierCoverage(requiredGroups, selected);
}

export function strictSemanticQualifierGaps(source: string, selector: string): SemanticQualifierGap[] {
  const required = uniqueBindings(strictSourceQualifierBindings(source));
  const selected = qualifierBindings(selector);
  const matchedRequired = maximumMatchedQualifierIndexes(required, selected);
  return required.flatMap((binding, index) =>
    matchedRequired.has(index)
      ? []
      : [{ qualifier: binding.id, anchors: [...binding.anchors], values: [...binding.values] }],
  );
}

function strictSourceQualifierBindings(value: string): QualifierBinding[] {
  return strictNormativeSourceSegments(value).flatMap((segment) => qualifierBindings(segment));
}

function uniqueBindings(bindings: readonly QualifierBinding[]): QualifierBinding[] {
  const seen = new Set<string>();
  return bindings.filter((binding) => {
    const signature = `${binding.id}:${[...binding.anchors].sort().join(",")}:${[...binding.values].sort().join(",")}`;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function qualifierBindings(value: string): QualifierBinding[] {
  return qualifierBindingGroups(value).flat();
}

function qualifierBindingGroups(value: string): QualifierBinding[][] {
  return semanticQualifierSegments(value).map((segment) => uniqueBindings(bindingsWithinLine(segment)));
}

function bindingsWithinLine(value: string): QualifierBinding[] {
  const terms = normalizedQualifierTerms(value);
  const bindings: QualifierBinding[] = [];
  for (let index = 0; index < terms.length; index++) {
    const match = recognizeQualifier(terms, index);
    if (!match) continue;
    const ignored = match.id === "order" ? ORDER_PREDICATE_TERMS : undefined;
    const after = anchorWindow(terms, match.end + 1, 1, 6, ignored);
    const before = anchorWindow(terms, match.start - 1, -1, 6, ignored);
    const anchors = match.preferBefore ? before : after.length > 0 ? after : before;
    const cardinality = match.preferBefore ? undefined : semanticCardinalityAfter(terms, match.end + 1);
    bindings.push({
      id: match.id,
      anchors: new Set(anchors),
      values: new Set(match.values ?? (cardinality ? [cardinality.value] : [])),
    });
    index = Math.max(match.end, cardinality?.end ?? match.end);
  }
  return bindings;
}

function anchorWindow(
  terms: readonly string[],
  start: number,
  direction: 1 | -1,
  maximum = 3,
  ignored: ReadonlySet<string> = new Set(),
): string[] {
  const anchors: string[] = [];
  for (let index = start; index >= 0 && index < terms.length && anchors.length < maximum; index += direction) {
    const term = terms[index]!;
    const isContentTerm =
      !ignored.has(term) &&
      !ANCHOR_STOP_WORDS.has(term) &&
      !SEMANTIC_QUALIFIER_TERMS.has(term) &&
      !isSemanticCardinalityTerm(term);
    if (direction === 1 && anchors.length > 0 && FORWARD_SUBJECT_BOUNDARIES.has(term)) {
      break;
    }
    if (isContentTerm) anchors.push(term);
  }
  return anchors;
}
