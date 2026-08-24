import type { TaskVerificationSourcePrompt } from "./types.ts";

export type RequirementSourceClauseKind = "heading" | "prose" | "code";

export interface RequirementSourceClause {
  id: string;
  sourcePromptIndex: number;
  kind: RequirementSourceClauseKind;
  text: string;
  normativeHint?: boolean;
}

export interface RequirementSourceClauseLocation {
  id: string;
  sourcePromptIndex: number;
  line: number;
  part: number;
}
export interface RequirementSourceClauseCatalogEntry extends RequirementSourceClause, RequirementSourceClauseLocation {}

interface ExtractedClause extends Pick<RequirementSourceClause, "kind" | "text" | "normativeHint"> {
  line: number;
  part: number;
}

interface LocatedRequirementSourceClause extends RequirementSourceClause, RequirementSourceClauseLocation {}

const AFFIRMATIVE_DELEGATION_LEAD_IN_PATTERN =
  /^(?:(?:\*{1,2}|_{1,2})\s*|(?:important|warning|action\s+required)\s*:\s*|as\s+a\s+prerequisite\s*[,;:]\s*|(?:please|first|next|then|immediately)\s*[,;:]?\s*|before\s+(?:continuing|proceeding)\s*[,;:]\s*|you\s+(?:must|should|need\s+to|are\s+required\s+to)\s+)+/iu;

const UNSAFE_DELEGATED_INSTRUCTION_PATTERN =
  /^(?:ignore\s+(?:all\s+)?(?:(?:earlier|previous|prior)\s+)?(?:system\s+)?instructions?|reveal\s+(?:all\s+)?(?:credentials?|private\s+keys?|secrets?|tokens?)|read\s+(?:files?\s+)?(?:outside|unrelated\s+to)\s+the\s+(?:task|workspace)|(?:send|upload)\s+(?:credentials?|private\s+keys?|secrets?|tokens?)|(?:disable|override)\s+(?:the\s+)?(?:controller|policy|verification))\b/iu;

const SENSITIVE_PATH_READ_PATTERN =
  /^read\s+(?:the\s+)?(?:\/(?:Users|home)\/\S+\/\.ssh\/\S+|~\/\.ssh\/\S+|\/etc\/(?:shadow|sudoers)\b|(?:\.\/)?\.env\b)/iu;

const EXTERNAL_ARTIFACT_EXFILTRATION_PATTERN =
  /^(?:send|upload)\s+(?:the\s+)?(?:repository\s+(?:source|code)|source\s+code|build\s+logs?)\s+(?:to|via)\s+(?:https?:\/\/\S+|(?:an?\s+)?url\b|(?:an?\s+)?email(?:\s+address)?\b|[\w.%+-]+@[\w.-]+\.[a-z]{2,}\b)/iu;

export function requirementSourceClauses(sources: readonly TaskVerificationSourcePrompt[]): RequirementSourceClause[] {
  return requirementSourceClauseCatalog(sources).map((clause) => ({
    id: clause.id,
    sourcePromptIndex: clause.sourcePromptIndex,
    kind: clause.kind,
    text: clause.text,
    ...(clause.normativeHint === true ? { normativeHint: true } : {}),
  }));
}

export function requirementSourceClauseLocations(
  sources: readonly TaskVerificationSourcePrompt[],
): RequirementSourceClauseLocation[] {
  return requirementSourceClauseCatalog(sources).map((clause) => ({
    id: clause.id,
    sourcePromptIndex: clause.sourcePromptIndex,
    line: clause.line,
    part: clause.part,
  }));
}

export function requirementSourceClauseCatalog(
  sources: readonly TaskVerificationSourcePrompt[],
): RequirementSourceClauseCatalogEntry[] {
  return locatedRequirementSourceClauses(sources);
}

function locatedRequirementSourceClauses(
  sources: readonly TaskVerificationSourcePrompt[],
): LocatedRequirementSourceClause[] {
  return sources.flatMap((source, sourceOffset) => {
    if (source.kind !== "referenced_file") return [];
    return extractClauses(source.text).map((clause, clauseOffset) => ({
      id: `S${sourceOffset + 1}-C${clauseOffset + 1}`,
      sourcePromptIndex: sourceOffset + 1,
      kind: clause.kind,
      text: clause.text,
      ...(clause.normativeHint === true ? { normativeHint: true } : {}),
      line: clause.line,
      part: clause.part,
    }));
  });
}

export function isUnsafeDelegatedInstruction(value: string): boolean {
  const imperative = value.trim().replace(AFFIRMATIVE_DELEGATION_LEAD_IN_PATTERN, "");
  return (
    UNSAFE_DELEGATED_INSTRUCTION_PATTERN.test(imperative) ||
    SENSITIVE_PATH_READ_PATTERN.test(imperative) ||
    EXTERNAL_ARTIFACT_EXFILTRATION_PATTERN.test(imperative)
  );
}

function extractClauses(source: string): ExtractedClause[] {
  const clauses: ExtractedClause[] = [];
  let inFence = false;
  for (const [lineOffset, rawLine] of source.split(/\r?\n/u).entries()) {
    const line = lineOffset + 1;
    const trimmed = rawLine.trim();
    if (/^```/u.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (!trimmed) continue;
    if (inFence) {
      clauses.push({ kind: "code", text: trimmed, line, part: 1 });
      continue;
    }
    const heading = trimmed.match(/^#{1,6}\s+(.+)$/u);
    if (heading) {
      clauses.push({ kind: "heading", text: heading[1]!.trim(), line, part: 1 });
      continue;
    }
    const listItem = /^(?:[-*+]\s+|\d+[.)]\s+)/u.test(trimmed);
    const withoutMarker = trimmed.replace(/^(?:[-*+]\s+|\d+[.)]\s+)/u, "");
    let part = 0;
    for (const partText of withoutMarker.split(/;|(?<=[.!?])\s+/u)) {
      const normalized = partText.trim();
      if (normalized) {
        part += 1;
        clauses.push({
          kind: "prose",
          text: normalized,
          ...(listItem ? { normativeHint: true } : {}),
          line,
          part,
        });
      }
    }
  }
  return clauses;
}
