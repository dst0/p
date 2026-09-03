const TERM_PATTERN = /\p{Sc}?[+-]?(?:\d+(?:\.\d+)?e[+-]?\d+|\d+\/\d+|\d+(?:\.\d+)?|\.\d+)%?|\p{L}+/gu;

export function normalizedQualifierTerms(value: string): string[] {
  const normalized = value
    .normalize("NFKC")
    .replace(/\b\d+(?:[,_]\d+)+\b/gu, (grouped) => grouped.replace(/[,_]/gu, ""))
    .replace(/\b\d{1,3}(?:[\u00a0\u202f ]\d{3})+\b/gu, (grouped) => grouped.replace(/[\u00a0\u202f ]/gu, ""))
    .toLocaleLowerCase("en-US");
  return normalized.match(TERM_PATTERN) ?? [];
}

export function semanticQualifierSegments(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .flatMap((line) => line.split(/(?<!e\.g\.)(?<=[.!?])\s+/iu))
    .flatMap((sentence) => sentence.split(/;|,\s*(?:but|however)\b/iu))
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}
