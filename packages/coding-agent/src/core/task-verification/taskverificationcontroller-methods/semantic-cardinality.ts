const SMALL_NUMBER_VALUES = new Map<string, number>([
  ["zero", 0],
  ["single", 1],
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
  ["eleven", 11],
  ["twelve", 12],
  ["thirteen", 13],
  ["fourteen", 14],
  ["fifteen", 15],
  ["sixteen", 16],
  ["seventeen", 17],
  ["eighteen", 18],
  ["nineteen", 19],
]);
const TENS_NUMBER_VALUES = new Map<string, number>([
  ["twenty", 20],
  ["thirty", 30],
  ["forty", 40],
  ["fifty", 50],
  ["sixty", 60],
  ["seventy", 70],
  ["eighty", 80],
  ["ninety", 90],
]);
const SCALE_NUMBER_VALUES = new Map<string, number>([
  ["thousand", 1_000],
  ["million", 1_000_000],
  ["billion", 1_000_000_000],
  ["trillion", 1_000_000_000_000],
]);
const CARDINALITY_PREFIX_TERMS = new Set(["a", "an", "the", "first", "last", "next", "initial", "final", "remaining"]);

export interface SemanticCardinality {
  value: string;
  end: number;
}

export function semanticCardinalityAfter(terms: readonly string[], start: number): SemanticCardinality | undefined {
  let firstIndex = start;
  while (
    firstIndex < start + 3 &&
    CARDINALITY_PREFIX_TERMS.has(terms[firstIndex] ?? "") &&
    terms[firstIndex + 1] !== undefined
  ) {
    firstIndex += 1;
  }
  const first = terms[firstIndex];
  if (!first) return undefined;
  if (isDigitLiteral(first)) return { value: normalizedDigitLiteral(first), end: firstIndex };
  const decimal = wordDecimal(terms, firstIndex);
  if (decimal) return decimal;

  let total = 0;
  let group = 0;
  let end = firstIndex - 1;
  let previousWasSmall = false;
  for (let index = firstIndex; index < terms.length; index++) {
    const term = terms[index]!;
    if (term === "and" && end >= firstIndex && isSemanticCardinalityTerm(terms[index + 1] ?? "")) {
      end = index;
      continue;
    }
    const small = SMALL_NUMBER_VALUES.get(term);
    if (small !== undefined) {
      if (previousWasSmall) break;
      group += small;
      end = index;
      previousWasSmall = true;
      continue;
    }
    const tens = TENS_NUMBER_VALUES.get(term);
    if (tens !== undefined) {
      group += tens;
      end = index;
      previousWasSmall = false;
      continue;
    }
    if (term === "hundred") {
      group = Math.max(1, group) * 100;
      end = index;
      previousWasSmall = false;
      continue;
    }
    const scale = SCALE_NUMBER_VALUES.get(term);
    if (scale !== undefined) {
      total += Math.max(1, group) * scale;
      group = 0;
      end = index;
      previousWasSmall = false;
      continue;
    }
    break;
  }
  return end >= firstIndex ? { value: String(total + group), end } : undefined;
}

export function isSemanticCardinalityTerm(term: string): boolean {
  return (
    isDigitLiteral(term) ||
    term === "hundred" ||
    term === "point" ||
    SMALL_NUMBER_VALUES.has(term) ||
    TENS_NUMBER_VALUES.has(term) ||
    SCALE_NUMBER_VALUES.has(term)
  );
}

function normalizedDigitLiteral(value: string): string {
  const match =
    /^(?<currency>\p{Sc}?)(?<sign>[+-]?)(?<number>\d+(?:\.\d+)?e[+-]?\d+|\d+\/\d+|\d+(?:\.\d+)?|\.\d+)(?<percent>%?)$/u.exec(
      value,
    );
  if (!match?.groups) return value;
  if (match.groups.number!.includes("e")) {
    const sign = match.groups.sign === "-" ? "-" : "";
    return `${match.groups.currency}${sign}${match.groups.number}${match.groups.percent}`;
  }
  if (match.groups.number!.includes("/")) {
    const [numerator, denominator] = match.groups.number!.split("/");
    const sign = match.groups.sign === "-" ? "-" : "";
    return `${match.groups.currency}${sign}${BigInt(numerator!).toString()}/${BigInt(denominator!).toString()}${match.groups.percent}`;
  }
  const absolute = match.groups.number!.startsWith(".") ? `0${match.groups.number}` : match.groups.number!;
  const [integer = "0", fraction] = absolute.split(".");
  const normalizedInteger = BigInt(integer).toString();
  const normalizedFraction = fraction?.replace(/0+$/u, "");
  const number = normalizedFraction ? `${normalizedInteger}.${normalizedFraction}` : normalizedInteger;
  const sign = match.groups.sign === "-" ? "-" : "";
  return `${match.groups.currency}${sign}${number}${match.groups.percent}`;
}

function isDigitLiteral(value: string): boolean {
  return /^\p{Sc}?[+-]?(?:\d+(?:\.\d+)?e[+-]?\d+|\d+\/\d+|\d+(?:\.\d+)?|\.\d+)%?$/u.test(value);
}

function wordDecimal(terms: readonly string[], start: number): SemanticCardinality | undefined {
  const whole = SMALL_NUMBER_VALUES.get(terms[start] ?? "");
  if (whole === undefined || terms[start + 1] !== "point") return undefined;
  let digits = "";
  let end = start + 1;
  for (let index = start + 2; index < terms.length; index++) {
    const digit = SMALL_NUMBER_VALUES.get(terms[index]!);
    if (digit === undefined || digit > 9) break;
    digits += String(digit);
    end = index;
  }
  return digits ? { value: `${whole}.${digits}`, end } : undefined;
}
