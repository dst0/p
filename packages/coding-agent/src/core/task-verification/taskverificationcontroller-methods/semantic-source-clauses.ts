const INFORMATIONAL_EXAMPLE_PATTERN =
  /^\s*(?:(?:[-*+>]\s+|#{1,6}\s+|\d+[.)]\s+))?(?:(?:for|as)\s+(?:an?\s+)?example\b|another example\b|examples?\s*:|e\.g\.(?:\s|$)|illustrative (?:sample|example)\b)/iu;
const INFORMATIONAL_REFERENCE_PATTERN =
  /^\s*(?:(?:[-*+>]\s+|\d+[.)]\s+))?(?:advanced|illustrative)\s+(?:demos?|demonstrations?|examples?|samples?)\b|\b(?:for|in)\s+(?:advanced\s+|illustrative\s+)?(?:demos?|demonstrations?|examples?|samples?)\b/iu;
const NORMATIVE_TRANSITION_PATTERN =
  /^(?:(?:the\s+)?(?:actual|normative|production|required)\b|.{0,120}\b(?:is\s+required\s+to|must|shall)\b)/iu;
const INFORMATIONAL_HEADING_PATTERN = /^\s*(?:#{1,6}\s+)?(?:(?:illustrative\s+)?examples?|sample output)\s*:?\s*$/iu;
const MARKDOWN_HEADING_PATTERN = /^\s*#{1,6}\s+/u;
const NORMATIVE_HEADING_PATTERN =
  /^\s*(?:acceptance criteria|behavio(?:u)?r|constraints?|inputs?|outputs?|requirements?|specification)\s*:\s*$/iu;

interface SourceClause {
  text: string;
  boundary: "start" | "semicolon" | "contrast";
}

export function strictNormativeSourceSegments(value: string): string[] {
  const normative: string[] = [];
  let informationalSection = false;
  for (const rawLine of value.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (INFORMATIONAL_HEADING_PATTERN.test(line)) {
      informationalSection = true;
      continue;
    }
    if (MARKDOWN_HEADING_PATTERN.test(line)) {
      informationalSection = false;
      continue;
    }
    if (NORMATIVE_HEADING_PATTERN.test(line)) {
      informationalSection = false;
      continue;
    }
    for (const segment of line.split(/(?<!e\.g\.)(?<=[.!?])\s+/iu)) {
      let informationalScope = informationalSection;
      for (const clause of sourceClauses(segment)) {
        const explicitInformational =
          INFORMATIONAL_EXAMPLE_PATTERN.test(clause.text) || INFORMATIONAL_REFERENCE_PATTERN.test(clause.text);
        if (explicitInformational) {
          informationalScope = true;
        } else if (clause.boundary === "contrast" || NORMATIVE_TRANSITION_PATTERN.test(clause.text)) {
          informationalScope = false;
          informationalSection = false;
        }
        if (!informationalScope) normative.push(clause.text);
      }
    }
  }
  return normative;
}

function sourceClauses(segment: string): SourceClause[] {
  const clauses: SourceClause[] = [];
  let start = 0;
  let boundary: SourceClause["boundary"] = "start";
  for (const match of segment.matchAll(/;|,\s*(?:but|however)\b/giu)) {
    const text = segment.slice(start, match.index).trim();
    if (text) clauses.push({ text, boundary });
    boundary = match[0].startsWith(";") ? "semicolon" : "contrast";
    start = match.index + match[0].length;
  }
  const text = segment.slice(start).trim();
  if (text) clauses.push({ text, boundary });
  return clauses;
}
