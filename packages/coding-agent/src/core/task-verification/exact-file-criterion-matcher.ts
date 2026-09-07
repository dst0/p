import { createHash } from "node:crypto";
import type { ExactFileBytesAssertionClaim } from "./exact-file-assertion-classifier.ts";

const NUMBER_WORDS = new Map(
  ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"].map(
    (word, index) => [word, index],
  ),
);
const JSON_STRING_SOURCE = '"(?:\\\\["\\/bfnrt]|\\\\u[0-9A-Fa-f]{4}|[^"\\\\\\u0000-\\u001f])*"';
const JSON_STRING_PATTERN = new RegExp(JSON_STRING_SOURCE, "gu");
const SINGLE_QUOTED_LINE_SOURCE = "'[^'\\\\\\r\\n]*'";
const NATURAL_QUOTED_LINE_PATTERN = new RegExp(`${JSON_STRING_SOURCE}|${SINGLE_QUOTED_LINE_SOURCE}`, "gu");
const EXACT_FILE_CRITERION_PATTERN = new RegExp(
  `exact_file_bytes\\s*\\(\\s*(${JSON_STRING_SOURCE})\\s*,\\s*(${JSON_STRING_SOURCE})\\s*\\)`,
  "gu",
);
const CANONICAL_PROSE_PATTERN =
  /^(?:(?:is\s+created\s+with|has|contains|consists\s+of)\s+)?exact\s+(?:bytes|content|text)(?:\s+(?:and|with)\s+(no\s+)?(?:a\s+)?(?:terminal|final|trailing)\s+(?:lf|newline))?(?:\s+and\s+no\s+extra\s+bytes)?$/iu;
const NATURAL_PROSE_PATTERN =
  /^(?:(?:is\s+created\s+with|exists\s+with|has|contains|consists\s+of)\s+)?exactly\s+(?:the\s+)?(?:(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+)?(?:lf|newline)[-\s]?terminated\s+(line|lines)(?:\s+(?:and\s+)?in\s+(?:that\s+)?order)?(?:\s+and\s+no\s+extra\s+bytes)?$/iu;

export function exactFileAssertionMatchesCriterion(criterion: string, claim: ExactFileBytesAssertionClaim): boolean {
  const expected = criterionExpectedBytes(criterion, claim.path);
  return expected !== undefined && hash(expected) === claim.expectedSha256;
}

export function exactFileAssertionProvesCriterion(criterion: string, claim: ExactFileBytesAssertionClaim): boolean {
  const canonicalMatches = [...criterion.matchAll(EXACT_FILE_CRITERION_PATTERN)];
  if (canonicalMatches.length > 1) return false;
  if (canonicalMatches.length === 1) return canonicalCriterionProves(criterion, claim, canonicalMatches[0]!);
  return naturalCriterionProves(criterion, claim);
}

function canonicalCriterionProves(
  criterion: string,
  claim: ExactFileBytesAssertionClaim,
  match: RegExpMatchArray,
): boolean {
  const selectedPath = parseJsonString(match[1]!);
  const expectedText = parseJsonString(match[2]!);
  if ((selectedPath !== claim.path && selectedPath !== `./${claim.path}`) || expectedText === undefined) return false;
  const expected = Buffer.from(expectedText, "utf8");
  if (hash(expected) !== claim.expectedSha256) return false;
  const prose = criterion.replace(EXACT_FILE_CRITERION_PATTERN, " ");
  if ([...prose.matchAll(JSON_STRING_PATTERN)].length > 0) return false;
  const normalized = normalizedProse(prose, claim.path);
  const proseMatch = CANONICAL_PROSE_PATTERN.exec(normalized);
  if (!proseMatch) return normalized.length === 0;
  const claimsNegativeNewline = proseMatch[1] !== undefined;
  const claimsNewline = /\b(?:terminal|final|trailing)\s+(?:lf|newline)\b/iu.test(normalized);
  const endsWithLf = expected.at(-1) === 0x0a;
  return (
    (!claimsNewline || endsWithLf !== claimsNegativeNewline) &&
    !/\bno\s+extra\s+(?:file|output|artifact)/iu.test(normalized)
  );
}

function naturalCriterionProves(criterion: string, claim: ExactFileBytesAssertionClaim): boolean {
  const lineMarker = naturalLineMarker(criterion);
  if (!lineMarker || !naturalSubjectMatches(criterion.slice(0, lineMarker.index), claim.path)) return false;
  const expected = naturalCriterionExpectedBytes(criterion);
  if (!expected || hash(expected) !== claim.expectedSha256) return false;
  const quoted = criterion.replace(NATURAL_QUOTED_LINE_PATTERN, " ");
  const normalized = normalizedProse(quoted, claim.path)
    .replace(/\band\b(?=\s*(?:in\s+(?:that\s+)?order)?$)/iu, "")
    .trim();
  const proseMatch = NATURAL_PROSE_PATTERN.exec(normalized);
  if (!proseMatch) return false;
  const actualLineCount = lineCount(expected);
  const declaredCount = proseMatch[1] ? parsedCount(proseMatch[1]) : undefined;
  const grammaticalCountMatches =
    proseMatch[2]?.toLocaleLowerCase("en-US") === "line" ? actualLineCount === 1 : actualLineCount > 1;
  return grammaticalCountMatches && (declaredCount === undefined || declaredCount === actualLineCount);
}

function naturalSubjectMatches(prefix: string, path: string): boolean {
  const quoted = [...prefix.matchAll(NATURAL_QUOTED_LINE_PATTERN)];
  if (quoted.length === 0) return criterionReferencesPath(prefix, path);
  if (quoted.length !== 1 || quoted[0]!.index === undefined || prefix.slice(0, quoted[0]!.index).trim().length > 0) {
    return false;
  }
  const subject = parseNaturalQuotedLine(quoted[0]![0]);
  return subject === path || subject === `./${path}`;
}

function criterionExpectedBytes(criterion: string, path: string): Buffer | undefined {
  const canonical = canonicalCriterionExpectedBytes(criterion, path);
  if (canonical || criterion.includes("exact_file_bytes")) return canonical;
  return naturalCriterionExpectedBytes(criterion);
}

function naturalCriterionExpectedBytes(criterion: string): Buffer | undefined {
  const lineMarker = naturalLineMarker(criterion);
  if (!lineMarker) return undefined;
  const contentList = criterion.slice(lineMarker.index + lineMarker[0].length);
  const quoted = [...contentList.matchAll(NATURAL_QUOTED_LINE_PATTERN)]
    .map((match) => parseNaturalQuotedLine(match[0]))
    .filter((value): value is string => value !== undefined);
  return quoted.length === 0 ? undefined : Buffer.from(`${quoted.join("\n")}\n`, "utf8");
}

function naturalLineMarker(criterion: string): RegExpExecArray | null {
  const masked = criterion.replace(NATURAL_QUOTED_LINE_PATTERN, (value) => " ".repeat(value.length));
  if (!/\bexactly\b/iu.test(masked)) return null;
  return /\b(?:lf|newline)[-\s]?terminated\s+lines?\b/iu.exec(masked);
}

function canonicalCriterionExpectedBytes(criterion: string, path: string): Buffer | undefined {
  const matches = [...criterion.matchAll(EXACT_FILE_CRITERION_PATTERN)];
  if (matches.length !== 1) return undefined;
  const selectedPath = parseJsonString(matches[0]![1]!);
  const expected = parseJsonString(matches[0]![2]!);
  if ((selectedPath !== path && selectedPath !== `./${path}`) || expected === undefined) return undefined;
  return Buffer.from(expected, "utf8");
}

function normalizedProse(prose: string, path: string): string {
  return prose
    .replaceAll(`./${path}`, " ")
    .replaceAll(path, " ")
    .replace(/[,:;.]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function criterionReferencesPath(criterion: string, path: string): boolean {
  const pathCharacters = /[A-Za-z0-9._@%+=,:/-]/u;
  return [path, `./${path}`].some((prefix) => {
    let offset = criterion.indexOf(prefix);
    while (offset !== -1) {
      const before = criterion[offset - 1];
      const after = criterion[offset + prefix.length];
      if ((!before || !pathCharacters.test(before)) && (!after || !pathCharacters.test(after))) return true;
      offset = criterion.indexOf(prefix, offset + 1);
    }
    return false;
  });
}

function parseJsonString(value: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseNaturalQuotedLine(value: string): string | undefined {
  return value.startsWith("'") ? value.slice(1, -1) : parseJsonString(value);
}

function parsedCount(value: string): number | undefined {
  return /^\d+$/u.test(value) ? Number(value) : NUMBER_WORDS.get(value.toLocaleLowerCase("en-US"));
}

function lineCount(value: Buffer): number {
  if (value.length === 0) return 0;
  const terminalNewline = value.at(-1) === 0x0a;
  return countByte(value, 0x0a) + (terminalNewline ? 0 : 1);
}

function hash(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function countByte(value: Buffer, byte: number): number {
  let count = 0;
  for (const candidate of value) if (candidate === byte) count += 1;
  return count;
}
