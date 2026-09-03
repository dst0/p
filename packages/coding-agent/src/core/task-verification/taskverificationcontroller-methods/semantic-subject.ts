const CANONICAL_ANCHORS = new Map<string, string>([
  ["complete", "success"],
  ["completed", "success"],
  ["completes", "success"],
  ["entries", "record"],
  ["entry", "record"],
  ["final", "trailing"],
  ["lf", "newline"],
  ["ms", "millisecond"],
  ["octet", "byte"],
  ["octets", "byte"],
  ["processes", "process"],
  ["row", "record"],
  ["rows", "record"],
  ["succeed", "success"],
  ["succeeds", "success"],
  ["successful", "success"],
  ["successfully", "success"],
]);
const ORDER_MODIFIER_ALIASES = new Map([
  ["asc", "ascending"],
  ["desc", "descending"],
  ["reversed", "reverse"],
]);
const CONTRADICTORY_ANCHOR_GROUPS = [
  ["accepted", "rejected"],
  ["before", "after"],
  ["client", "server"],
  ["decoded", "encoded"],
  ["destination", "source"],
  ["first", "last"],
  ["included", "excluded"],
  ["inbound", "outbound"],
  ["input", "output"],
  ["local", "remote"],
  ["minimum", "maximum"],
  ["old", "new"],
  ["plaintext", "encrypted"],
  ["primary", "secondary"],
  ["private", "public"],
  ["request", "response"],
  ["read", "write"],
  ["success", "failure"],
  ["sync", "async"],
  ["upstream", "downstream"],
  ["valid", "invalid"],
] as const;

export function normalizedSemanticAnchors(anchors: ReadonlySet<string>): ReadonlySet<string> {
  const normalized = new Set([...anchors].map(normalizedSemanticAnchor));
  if (normalized.has("newline")) normalized.delete("byte");
  return normalized;
}

export function normalizedOrderModifier(value: string): string {
  return ORDER_MODIFIER_ALIASES.get(value) ?? value;
}

export function semanticAnchorsContradict(required: ReadonlySet<string>, selected: ReadonlySet<string>): boolean {
  const requiredTerms = [...required];
  const selectedTerms = [...selected];
  return requiredTerms.some((left) =>
    selectedTerms.some(
      (right) =>
        areNegativeVariants(left, right) ||
        CONTRADICTORY_ANCHOR_GROUPS.some(
          ([first, second]) => (first === left && second === right) || (first === right && second === left),
        ),
    ),
  );
}

function normalizedSemanticAnchor(term: string): string {
  const canonical = CANONICAL_ANCHORS.get(term);
  if (canonical) return canonical;
  const singular = singularAnchor(term);
  return CANONICAL_ANCHORS.get(singular) ?? singular;
}

function singularAnchor(term: string): string {
  if (term.length > 4 && term.endsWith("ies")) return `${term.slice(0, -3)}y`;
  if (term.length > 4 && term.endsWith("ses")) return term.slice(0, -1);
  if (term.length > 3 && term.endsWith("s") && !/(?:is|ss|us)$/u.test(term)) return term.slice(0, -1);
  return term;
}

function areNegativeVariants(left: string, right: string): boolean {
  return negativeBase(left) === right || negativeBase(right) === left;
}

function negativeBase(term: string): string | undefined {
  if (term.startsWith("non") && term.length > 6) return term.slice(3);
  if (term.startsWith("un") && term.length > 4) return term.slice(2);
  return undefined;
}
