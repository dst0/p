import { semanticCardinalityAfter } from "./semantic-cardinality.ts";
import { normalizedOrderModifier } from "./semantic-subject.ts";

const ORDER_VALUE_TERMS = new Set([
  "alphabetical",
  "ascending",
  "chronological",
  "descending",
  "insertion",
  "lexicographic",
  "original",
  "reverse",
  "stable",
]);
const ORDER_ADVERB_VALUES = new Map([
  ["alphabetically", "alphabetical"],
  ["chronologically", "chronological"],
  ["lexicographically", "lexicographic"],
]);

export const SEMANTIC_QUALIFIER_TERMS = new Set([
  "all",
  "any",
  "at",
  "each",
  "every",
  "exact",
  "exactly",
  "least",
  "more",
  "most",
  "no",
  "none",
  "not",
  "only",
  "order",
  "ordered",
  "ordering",
  "precisely",
  "sequence",
  "sole",
  "solely",
  "within",
  "without",
  "zero",
]);

export interface QualifierMatch {
  id: "exact" | "lower-bound" | "order" | "universal" | "upper-bound";
  start: number;
  end: number;
  preferBefore?: boolean;
  values?: string[];
}

export function recognizeQualifier(terms: readonly string[], index: number): QualifierMatch | undefined {
  const term = terms[index];
  if (term === "any" && ["choose", "chooses", "pick", "picks", "select", "selects"].includes(terms[index - 1] ?? "")) {
    return undefined;
  }
  if (["all", "any", "each", "every"].includes(term ?? "")) return match("universal", index);
  if (["exact", "exactly", "only", "precisely", "sole", "solely"].includes(term ?? "")) {
    if (
      term === "only" &&
      ["after", "before", "if", "provided", "unless", "when", "while"].includes(terms[index + 1] ?? "")
    ) {
      return undefined;
    }
    return match("exact", index);
  }
  if (term === "at" && terms[index + 1] === "least") return { ...match("lower-bound", index), end: index + 1 };
  if (term === "at" && terms[index + 1] === "most") return { ...match("upper-bound", index), end: index + 1 };
  if (term === "no" && ["later", "more"].includes(terms[index + 1] ?? "") && terms[index + 2] === "than") {
    return { ...match("upper-bound", index), end: index + 2 };
  }
  if (term === "no" && ["fewer", "less"].includes(terms[index + 1] ?? "") && terms[index + 2] === "than") {
    return { ...match("lower-bound", index), end: index + 2 };
  }
  if (term === "no" && terms[index + 1] === "need") return undefined;
  if (term === "within" && semanticCardinalityAfter(terms, index + 1)) return match("upper-bound", index);
  if (["no", "none", "without"].includes(term ?? "")) return { ...match("upper-bound", index), values: ["0"] };
  if (term === "zero" && !SEMANTIC_QUALIFIER_TERMS.has(terms[index - 1] ?? "")) {
    return { ...match("upper-bound", index), values: ["0"] };
  }
  if (
    term === "not" &&
    ["can", "did", "do", "does", "may", "must", "shall", "should", "will"].includes(terms[index - 1] ?? "")
  ) {
    return { ...match("upper-bound", index - 1), end: Math.min(index + 1, terms.length - 1), values: ["0"] };
  }
  if (term === "order") return recognizeOrder(terms, index);
  if (term === "sequence" && terms[index - 1] === "in") {
    return { ...match("order", index - 1), end: index, preferBefore: true };
  }
  if (term === "sequence" && terms[index + 1] === "of") return { ...match("order", index), end: index + 1 };
  if (["ordered", "ordering"].includes(term ?? "")) {
    const values = terms
      .slice(Math.max(0, index - 2), index)
      .filter((value) => ORDER_VALUE_TERMS.has(value))
      .map(normalizedOrderModifier);
    return { ...match("order", index), values };
  }
  const adverbValue = ORDER_ADVERB_VALUES.get(term ?? "");
  return adverbValue ? { ...match("order", index), preferBefore: true, values: [adverbValue] } : undefined;
}

function recognizeOrder(terms: readonly string[], index: number): QualifierMatch | undefined {
  const inIndex = [index - 1, index - 2, index - 3].find((candidate) => terms[candidate] === "in");
  if (inIndex !== undefined) {
    if (inIndex === index - 1 && ["for", "to"].includes(terms[index + 1] ?? "")) return undefined;
    const values = terms.slice(inIndex + 1, index).map(normalizedOrderModifier);
    return { ...match("order", inIndex), end: index, preferBefore: true, values };
  }
  if (["maintain", "maintains", "preserve", "preserves"].includes(terms[index - 1] ?? "")) {
    return { ...match("order", index), preferBefore: true };
  }
  return undefined;
}

function match(id: QualifierMatch["id"], index: number): QualifierMatch {
  return { id, start: index, end: index };
}
