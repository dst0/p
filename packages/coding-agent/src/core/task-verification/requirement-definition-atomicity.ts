import { HIGH_RISK_REQUIREMENT_PATTERN } from "./constants.ts";

const OBSERVABLE_OUTCOME_FAMILIES = [
  /\b(?:accept(?:s|ed|ing)?|allow(?:s|ed|ing)?|permit(?:s|ted|ting)?)\b/iu,
  /\b(?:block(?:s|ed|ing)?|denied|denies|deny|denying|reject(?:s|ed|ing)?|throw(?:s|ing)?|threw|thrown)\b/iu,
  /\breturn(?:s|ed|ing)?\b/iu,
  /\b(?:append(?:s|ed|ing)?|creat(?:e|es|ed|ing)|delet(?:e|es|ed|ing)|remov(?:e|es|ed|ing)|updat(?:e|es|ed|ing)|writ(?:e|es|ing|ten))\b/iu,
  /\b(?:check(?:s|ed|ing)?|validat(?:e|es|ed|ing)|verif(?:y|ies|ied|ying))\b/iu,
  /\b(?:preserv(?:e|es|ed|ing)|retain(?:s|ed|ing)?)\b/iu,
  /\brecord(?:s|ed|ing)?\s+(?:an?|the)\b|\b(?:are|gets?|is|was|were)\s+logged\b/iu,
  /\b(?:rolls?\s+back|rolled\s+back)\b/iu,
];
const AUDIT_MODAL_ACTION_PATTERN = /\b(?:can|could|may|might|must|shall|should|to|will|would)\s+audit\b/iu;
const AUDIT_NOUN_SUBJECT_PATTERN =
  /(?:^|[.!?;]\s*)audit(?:\s+[\p{L}\p{N}_-]+){1,4}\s+(?:are|gets?|is|remains?|was|were)\b/giu;
const AUDIT_ACTION_PATTERN =
  /(?:^|[.!?;]\s*|\b(?:and|but|then)\s+)audit(?:s|ing)?\b|\b(?:are|is|was|were)\s+auditing\b|\b(?:are|be|been|being|gets?|got|is|was|were)\s+audited\b|\b(?:the\s+)?[\p{L}\p{N}_-]+\s+audits\s+(?!(?:are|remain\w*|preserv\w*)\b)[\p{L}\p{N}_-]+\b|\b(?:(?:that|the|this)\s+(?![\p{L}\p{N}_-]*ly\b)[\p{L}\p{N}_-]+|(?!(?:a|an|that|the|this)\b|[\p{L}\p{N}_-]*ly\b)[\p{L}\p{N}_-]+)\s+audited\s+(?!(?:are|remain\w*|preserv\w*)\b)[\p{L}\p{N}_-]+\b|\b(?:audits|audited)\s+(?:all|an?|each|every|that|the|this)\b/iu;
const HIGH_RISK_CASE_FAMILIES = [
  /\bmalform\w*\b/iu,
  /\bempty\b/iu,
  /\btamper\w*\b/iu,
  /\btruncat\w*\b|\bunterminat\w*\b|\b(?:missing|absent|omit(?:ted)?)\s+(?:its\s+)?terminal\s+new\s*line\b/iu,
  /\b(?:missing|absent|omit(?:ted)?)\b/iu,
  /\binvalid\b/iu,
  /\bnon[-\s]?sequential\w*\b|\bout[-\s]?of[-\s]?order\b|\bposition\s+(?:gap|mismatch)\b/iu,
  /\bversion\s*(?:gap|mismatch)|\bversion[-\s]?mismatch|\bexpectedVersion\b/iu,
  /\bhash\s+chain\b|\bprevious\s*hash\b|\bhash\s+(?:continuity|mismatch)\b/iu,
  /\b(?:impossible|invalid)\s+(?:event\s+)?transition\b/iu,
  /\b(?:unauthenticated|unauthorized|expired|revoked)\b/iu,
];
const CASE_COORDINATOR_PATTERN = /,|\/|&|\b(?:and|or)\b/iu;
const FAILURE_PRESERVATION_PATTERN =
  /\b(?:all[-\s]?or[-\s]?nothing|atomic\w*|does\s+not\s+(?:advance|append|change|consume)|fail\w*|invalid|no\s+partial\s+mutation|preserv\w*|restor\w*|rollback|stale|unchanged)\b/iu;
const ROLLBACK_OBSERVABLES = [
  /\bstate\b/iu,
  /\b(?:event[-\s]?logs?|history|logs?)\b/iu,
  /\bversions?\b/iu,
  /\bpositions?\b/iu,
  /\b(?:command[-\s]?ids?|idempoten\w*)\b/iu,
];

export function compoundHighRiskRequirementError(text: string, acceptanceCriterion: string): string | undefined {
  const combined = `${text}\n${acceptanceCriterion}`;
  if (!HIGH_RISK_REQUIREMENT_PATTERN.test(combined)) return undefined;
  const outcomeCount =
    OBSERVABLE_OUTCOME_FAMILIES.filter((pattern) => pattern.test(acceptanceCriterion)).length +
    Number(hasAuditAction(acceptanceCriterion));
  const coordinatedCaseCount = acceptanceCriterion
    .split(CASE_COORDINATOR_PATTERN)
    .filter((segment) => HIGH_RISK_CASE_FAMILIES.some((pattern) => pattern.test(segment))).length;
  const sentenceCount = acceptanceCriterion.split(/[.!?]+(?=\s|$)/u).filter((part) => part.trim().length > 0).length;
  const rollbackObservableCount = FAILURE_PRESERVATION_PATTERN.test(combined)
    ? ROLLBACK_OBSERVABLES.filter((pattern) => pattern.test(combined)).length
    : 0;
  if (
    acceptanceCriterion.includes(";") ||
    outcomeCount > 1 ||
    coordinatedCaseCount > 1 ||
    rollbackObservableCount > 1 ||
    sentenceCount > 1
  ) {
    return "split each high-risk outcome or listed case into its own atomic requirement";
  }
  return undefined;
}

function hasAuditAction(value: string): boolean {
  if (AUDIT_MODAL_ACTION_PATTERN.test(value)) return true;
  return AUDIT_ACTION_PATTERN.test(value.replace(AUDIT_NOUN_SUBJECT_PATTERN, ""));
}
