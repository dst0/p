import { BUG_PATTERN, DOCS_PATTERN, INVESTIGATION_PATTERN, REFACTOR_PATTERN } from "./constants.ts";
import type { TaskKind } from "./types.ts";

const STRUCTURAL_CLAUSE_SPLIT_PATTERN = /[!?,:;\n]+|\s+(?:—|–|-)\s+|\.(?=\s|$)/u;
const COORDINATED_ACTION_SPLIT_PATTERN =
  /\b(?:also|and|as\s+well\s+as|but|plus|then|while)\b(?=\s+(?:add|adjust|alter|apply|assess|audit|build|change|clarify|code|configure|correct|create|delete|deploy|develop|diagnose|disable|document|edit|enable|explain|fix|implement|include|inspect|install|introduce|investigate|keep|maintain|migrate|modify|move|organize|patch|port|preserve|program|publish|refactor|remove|rename|reorganize|repair|replace|resolve|restart|retain|review|rewrite|rotate|schedule|scaffold|send|set|summarize|update|wire|write)\b)|\s+(?:а\s+также|и|затем|плюс)\s+(?=(?:добав|документир|измен|исправ|обнов|объясн|отправ|перемест|переимен|реализ|рефактор|созда|суммар|удал|уточн)\w*)/iu;
const POLITE_PREFIX_PATTERN =
  /^(?:(?:can|could|would)\s+you\s+|i\s+need\s+you\s+to\s+|please\s+|we\s+need\s+to\s+|what\s+(?:i\s+(?:need|want)(?:\s+you\s+to\s+do\s+is|\s+is\s+for\s+you\s+to)|you\s+should\s+do\s+is)\s+)+/iu;
const NEGATED_ACTION_PATTERN = /^(?:do not|don't|never|without)\b/iu;
const FIX_ACTION_PATTERN = /^(?:correct|fix|patch|repair|resolve)\b|^исправ\w*/iu;
const REFACTOR_ACTION_PATTERN = /^(?:refactor|reorganize|restructure)\b|^(?:рефактор|реорганиз|перестро)\w*/iu;
const BEHAVIOR_CHANGE_ACTION_PATTERN = /^(?:adjust|alter|change|modify|update)\b|^(?:измен|обнов|скорректир)\w*/iu;
const BEHAVIOR_TARGET_PATTERN =
  /\b(?:algorithm|behaviou?r|cache|calculation|engine|flow|handler|handling|implementation|logic|parser|policy|protocol|retry|state\s+transition|timeout|validation|workflow)\b|(?:алгоритм|валидац|движок|задержк|логик|обработ|парсер|поведен|политик|повтор|поток|протокол|состояни)/iu;
const CODE_ACTION_PATTERN =
  /^(?:build|code|develop|implement|port|program|scaffold)\b|^(?:внедри|разработ|реализ)\w*/iu;
const GENERAL_MUTATION_ACTION_PATTERN =
  /^(?:add|apply|change|configure|create|delete|disable|edit|enable|install|introduce|modify|move|organize|publish|remove|rename|replace|schedule|send|set|update|wire|write)\b|^(?:добав|настро|обнов|отправ|переимен|перемест|созда|удал)\w*/iu;
const DOCS_ACTION_PATTERN = /^(?:clarify|document|rewrite)\b|^(?:документир|перепиши|уточни)\w*/iu;
const DOCS_REFERENCE_PATTERN =
  /\b(?:according\s+to|described|documented|outlined|per|specified)\b|(?:в\s+соответствии\s+с|описан\p{L}*\s+в|согласно)|(?:^|\s)по\s*$/iu;
const DOCS_REFERENCE_FRAGMENT_PATTERN =
  /^(?:(?:described|documented|mentioned|outlined|specified)\b|(?:описан|упомянут)\w*)/iu;
const DOCS_CONTINUATION_PHRASE_PATTERN =
  /^(?:(?:add|include|insert|keep|maintain|preserve|remove|retain|update)\s+)?(?:(?:a|an|current|existing|its|new|same|the|troubleshooting|usage)\s+)*(?:changelog|content|copy|docs?|documentation|examples?|format|guide|headings?|layout|links?|organization|readme|reference|sections?|structure|style|tone)(?:\.md)?$|^(?:(?:добав|включ|встав|обнов|сохран|удал)\p{L}*\s+)?(?:(?:его|ее|её|их|нов\p{L}*|существующ\p{L}*|текущ\p{L}*)\s+)*(?:документ\p{L}*|заголов\p{L}*|инструкц\p{L}*|пример\p{L}*|раздел\p{L}*|ридми|ссыл\p{L}*|структур\p{L}*|стил\p{L}*|формат\p{L}*)$/iu;
const DOCS_EXPLICIT_CONTINUATION_ACTION_PATTERN =
  /^(?:add|include|insert|keep|maintain|preserve|remove|retain|update)\b/iu;
const DOCS_NOUN_PATTERN = /^(?:docs?|documentation|readme|changelog)\b|^(?:документ|ридми|чейнджлог)/iu;
const BARE_DOCS_TARGET_PATTERN =
  /^(?:the\s+)?(?:docs?|documentation|readme(?:\.md)?|changelog(?:\.md)?)(?:\s+files?)?$|^(?:документ\p{L}*|ридми|чейнджлог)$/iu;
const RESPONSE_ONLY_PATTERN =
  /^(?:(?:answer|calculate|check|compare|describe|give|list|read|report|show|tell|translate)\b|(?:how|what|when|where|which|who|why)\b|(?:are|can|could|did|do|does|is|should|was|were|will|would)\b)|^(?:ответ|перевед|прочит|расскаж|сравн)\w*/iu;
const RESPONSE_COMPOSITION_ACTION_PATTERN = /^(?:compose|draft|write)\b/iu;
const RESPONSE_DIRECTIVE_PATTERN =
  /(?:^|[.!?,:;\n]|\s+(?:and|but|then)\s+|\s+(?:—|–|-)\s+)(?:\s*please\s+)?(?:answer|calculate|check|compare|compose|describe|draft|explain|give|list|read|report|show|summarize|tell|translate|write)\b/iu;
const RESPONSE_SUBJECT_QUESTION_PATTERN =
  /(?:^|[.!?,:;\n]|\s+(?:and|but|then)\s+|\s+(?:—|–|-)\s+)(?:\s*please\s+)?(?:answer|calculate|check|compare|compose|describe|draft|explain|give|list|read|report|show|summarize|tell|translate|write)\b(?:\s+me)?\s+(?:how|what|when|where|which|who|why)\b/iu;
const RESPONSE_EFFECT_ACTION_FORM_SOURCE =
  "(?:(?:add|adjust|alter|apply|build|chang|configur|correct|creat|delet|deploy|develop|disabl|edit|enabl|fix|implement|install|introduc|modif|mov|organiz|patch|port|program|publish|refactor|remov|renam|repair|replac|resolv|restart|rotat|schedul|send|set|updat|wir|writ)\\p{L}*|built|sent|wrote)";
const RESPONSE_EFFECT_GERUND_SOURCE =
  "(?:adding|adjusting|altering|applying|building|changing|configuring|correcting|creating|deleting|deploying|developing|disabling|editing|enabling|fixing|implementing|installing|introducing|modifying|moving|organizing|patching|porting|programming|publishing|refactoring|removing|renaming|repairing|replacing|resolving|restarting|rotating|scheduling|sending|setting|updating|wiring|writing)";
const RESPONSE_EFFECT_ADVERB_SOURCE = "[\\p{L}-]+ly";
const RESPONSE_COORDINATED_EFFECT_PREREQUISITE_PATTERN = new RegExp(
  `\\bbut\\s+(?:please\\s+)?first\\s*,?\\s*(?:please\\s+)?(?:(?:you|we)\\s+)?${RESPONSE_EFFECT_ACTION_FORM_SOURCE}\\b`,
  "iu",
);
const RESPONSE_SENTENCE_FIRST_EFFECT_PREREQUISITE_PATTERN = new RegExp(
  `(?:^(?:[-*+]\\s+)?|(?:[.!?,:;]\\s+|\\n\\s*(?:[-*+]\\s+)?|\\s+[—–-]\\s+)(?:and\\s+)?)(?:please\\s+)?first\\s*,?\\s*(?:please\\s+)?(?:(?:you|we)\\s+)?${RESPONSE_EFFECT_ACTION_FORM_SOURCE}\\b`,
  "iu",
);
const RESPONSE_OPERATIONAL_TEMPORAL_PATTERN = new RegExp(
  `\\b(?:after|before|following|once|until|upon|when|as\\s+soon\\s+as)\\s+(?:(?:(?:you|we)(?:\\s*(?:['’](?:ve|re|ll|d))|\\s+(?:are|did|do|had|have|were|will))?\\s+(?:${RESPONSE_EFFECT_ADVERB_SOURCE}\\s+){0,2}(?:(?:done|finish(?:ed)?|complet(?:e|ed))\\s+)?(?:${RESPONSE_EFFECT_ADVERB_SOURCE}\\s+){0,2}${RESPONSE_EFFECT_ACTION_FORM_SOURCE})|(?:${RESPONSE_EFFECT_ADVERB_SOURCE}\\s+){0,2}${RESPONSE_EFFECT_GERUND_SOURCE}|(?:(?:the\\s+)?(?:[\\p{L}\\p{N}_.-]+\\s+){1,4}(?:(?:(?:has|have)\\s+been|is|was|were)\\s+)(?:${RESPONSE_EFFECT_ADVERB_SOURCE}\\s+){0,2}${RESPONSE_EFFECT_ACTION_FORM_SOURCE}))\\b`,
  "giu",
);
const RESPONSE_EFFECT_NOMINAL_PREREQUISITE_PATTERN = /\bfollowing\s+(?:the\s+)?creation\s+of\b/giu;
const RESPONSE_DESTINATION_PATTERN =
  /\b(?:in|within)\s+(?:the\s+|your\s+)?(?:answer|chat|reply|response)(?=$|\s|[!?,:;—–-]|\.(?=\s|$))/iu;
const CLOSED_RESPONSE_COMPOSITION_PATTERN =
  /^(?:compose|draft|write)\b[\s\S]*\b(?:in|within)\s+(?:the\s+|your\s+)?(?:answer|chat|reply|response)(?:\s+(?:briefly|concisely|only|verbatim))*(?:\s*,?\s*please)?\s*[.!]?$/iu;
const CLOSED_RESPONSE_DESTINATION_SUFFIX_PATTERN =
  /^(?:\s+(?:briefly|concisely|only|verbatim))*(?:\s*,?\s*please)?\s*[.!?]?\s*$/iu;

export function inferTaskKind(taskText: string): TaskKind | undefined {
  const clauses = actionClauses(taskText);
  if (clauses.some((clause) => FIX_ACTION_PATTERN.test(clause))) return "bug_fix";
  if (clauses.some((clause) => REFACTOR_ACTION_PATTERN.test(clause))) return "refactor";
  if (clauses.some(isBehaviorChangeClause)) return "behavior_change";
  if (clauses.some((clause) => CODE_ACTION_PATTERN.test(clause))) return "feature";
  const mentionsDocs = DOCS_PATTERN.test(taskText);
  if (mentionsDocs) {
    if (clausesAreDocsCompatible(clauses)) {
      if (hasDocsMutation(clauses)) return "docs";
      if (INVESTIGATION_PATTERN.test(taskText)) return "investigation";
    }
    if (clauses.some(isReferencedNonDocsMutationClause)) return "feature";
    return undefined;
  }
  if (clauses.some(isNonDocsMutationClause)) return "feature";
  if (INVESTIGATION_PATTERN.test(taskText)) return "investigation";
  if (RESPONSE_ONLY_PATTERN.test(taskText.trim().replace(POLITE_PREFIX_PATTERN, ""))) return "investigation";
  if (clauses.some(isExplicitResponseComposition)) return "investigation";
  if (BUG_PATTERN.test(taskText)) return "bug_fix";
  if (REFACTOR_PATTERN.test(taskText)) return "refactor";
  if (DOCS_PATTERN.test(taskText)) return "docs";
  return "feature";
}

export function taskTextRequestsEffect(taskText: string): boolean {
  const clauses = actionClauses(taskText);
  return (
    clauses.some((clause) => FIX_ACTION_PATTERN.test(clause)) ||
    clauses.some((clause) => REFACTOR_ACTION_PATTERN.test(clause)) ||
    clauses.some(isBehaviorChangeClause) ||
    clauses.some((clause) => CODE_ACTION_PATTERN.test(clause)) ||
    hasDocsMutation(clauses) ||
    clauses.some(isNonDocsMutationClause)
  );
}

export function taskTextHasAmbiguousEffect(taskText: string): boolean {
  const normalized = taskText.trim().replace(POLITE_PREFIX_PATTERN, "");
  if (
    RESPONSE_COORDINATED_EFFECT_PREREQUISITE_PATTERN.test(normalized) ||
    RESPONSE_SENTENCE_FIRST_EFFECT_PREREQUISITE_PATTERN.test(normalized)
  ) {
    return true;
  }
  if (!RESPONSE_DIRECTIVE_PATTERN.test(normalized)) return false;
  const destination = RESPONSE_DESTINATION_PATTERN.exec(normalized);
  if (destination) {
    const suffix = normalized.slice((destination.index ?? 0) + destination[0].length);
    if (!CLOSED_RESPONSE_DESTINATION_SUFFIX_PATTERN.test(suffix)) return true;
  }
  return hasUnownedResponsePrecondition(normalized);
}

function hasUnownedResponsePrecondition(taskText: string): boolean {
  for (const pattern of [RESPONSE_OPERATIONAL_TEMPORAL_PATTERN, RESPONSE_EFFECT_NOMINAL_PREREQUISITE_PATTERN]) {
    for (const match of taskText.matchAll(pattern)) {
      if (!responseSubjectQuestionOwnsMarker(taskText, match.index ?? 0)) return true;
    }
  }
  return false;
}

function responseSubjectQuestionOwnsMarker(taskText: string, markerIndex: number): boolean {
  const prefix = taskText.slice(0, markerIndex);
  const clauseStart = Math.max(
    prefix.lastIndexOf("."),
    prefix.lastIndexOf("!"),
    prefix.lastIndexOf("?"),
    prefix.lastIndexOf(","),
    prefix.lastIndexOf(":"),
    prefix.lastIndexOf(";"),
    prefix.lastIndexOf("\n"),
  );
  const clausePrefix = prefix
    .slice(clauseStart + 1)
    .trim()
    .replace(/^(?:and|but|then)\s+/iu, "");
  return RESPONSE_SUBJECT_QUESTION_PATTERN.test(clausePrefix);
}

function actionClauses(taskText: string): string[] {
  return taskText
    .split(STRUCTURAL_CLAUSE_SPLIT_PATTERN)
    .flatMap((clause) => clause.split(COORDINATED_ACTION_SPLIT_PATTERN))
    .map((clause) => clause.trim().replace(POLITE_PREFIX_PATTERN, ""))
    .filter(Boolean);
}

function isBehaviorChangeClause(clause: string): boolean {
  if (
    NEGATED_ACTION_PATTERN.test(clause) ||
    !BEHAVIOR_CHANGE_ACTION_PATTERN.test(clause) ||
    !BEHAVIOR_TARGET_PATTERN.test(clause)
  ) {
    return false;
  }
  const docsTargetIndex = clause.search(DOCS_PATTERN);
  return (
    docsTargetIndex < 0 ||
    isReferencedDocsTarget(clause, docsTargetIndex) ||
    isCoordinatedDocsTarget(clause, docsTargetIndex) ||
    hasUnmodeledCoordinatedEffect(clause, docsTargetIndex)
  );
}

function clausesAreDocsCompatible(clauses: readonly string[]): boolean {
  let docsContext = false;
  for (const clause of clauses) {
    if (
      NEGATED_ACTION_PATTERN.test(clause) ||
      DOCS_REFERENCE_FRAGMENT_PATTERN.test(clause) ||
      BARE_DOCS_TARGET_PATTERN.test(clause)
    ) {
      continue;
    }
    if (INVESTIGATION_PATTERN.test(clause)) {
      if (DOCS_PATTERN.test(clause)) docsContext = true;
      continue;
    }
    const docsTargetIndex = clause.search(DOCS_PATTERN);
    if (docsTargetIndex >= 0 && isReferencedDocsTarget(clause, docsTargetIndex)) return false;
    if (docsTargetIndex >= 0 && isDocsMutationClause(clause)) {
      if (hasUnmodeledCoordinatedEffect(clause, docsTargetIndex)) return false;
      docsContext = true;
      continue;
    }
    if (isDocsContinuation(clause, docsContext)) {
      docsContext = true;
      continue;
    }
    return false;
  }
  return true;
}

function hasDocsMutation(clauses: readonly string[]): boolean {
  let docsContext = false;
  for (const clause of clauses) {
    if (isDocsMutationClause(clause) || isDocsContinuation(clause, docsContext)) return true;
    if (DOCS_PATTERN.test(clause)) docsContext = true;
  }
  return false;
}

function hasUnmodeledCoordinatedEffect(clause: string, docsTargetIndex: number): boolean {
  const fragments = clause
    .slice(docsTargetIndex)
    .split(/\b(?:also|and|then)\s+|\s+(?:а\s+также|и|затем)\s+/iu)
    .slice(1)
    .map((fragment) => fragment.trim())
    .filter(Boolean);
  return fragments.some((fragment) => {
    if (BEHAVIOR_TARGET_PATTERN.test(fragment)) return true;
    return (
      !isDocsContinuation(fragment, true) && !DOCS_NOUN_PATTERN.test(fragment) && !/^[\p{L}\p{N}_-]+$/u.test(fragment)
    );
  });
}

function isDocsContinuation(clause: string, docsContext: boolean): boolean {
  if (DOCS_PATTERN.test(clause)) return DOCS_EXPLICIT_CONTINUATION_ACTION_PATTERN.test(clause);
  return docsContext && (DOCS_ACTION_PATTERN.test(clause) || DOCS_CONTINUATION_PHRASE_PATTERN.test(clause));
}

function isReferencedNonDocsMutationClause(clause: string): boolean {
  const docsTargetIndex = clause.search(DOCS_PATTERN);
  return docsTargetIndex >= 0 && isReferencedDocsTarget(clause, docsTargetIndex) && isNonDocsMutationClause(clause);
}

function isNonDocsMutationClause(clause: string): boolean {
  if (
    NEGATED_ACTION_PATTERN.test(clause) ||
    (RESPONSE_COMPOSITION_ACTION_PATTERN.test(clause) && RESPONSE_DESTINATION_PATTERN.test(clause))
  ) {
    return false;
  }
  if (CODE_ACTION_PATTERN.test(clause)) return true;
  if (!GENERAL_MUTATION_ACTION_PATTERN.test(clause)) return false;
  const docsTargetIndex = clause.search(DOCS_PATTERN);
  return (
    docsTargetIndex < 0 ||
    isReferencedDocsTarget(clause, docsTargetIndex) ||
    isCoordinatedDocsTarget(clause, docsTargetIndex)
  );
}

function isExplicitResponseComposition(clause: string): boolean {
  return CLOSED_RESPONSE_COMPOSITION_PATTERN.test(clause);
}

function isDocsMutationClause(clause: string): boolean {
  if (NEGATED_ACTION_PATTERN.test(clause)) return false;
  const docsTargetIndex = clause.search(DOCS_PATTERN);
  if (docsTargetIndex < 0) return false;
  if (DOCS_ACTION_PATTERN.test(clause)) return true;
  return (
    GENERAL_MUTATION_ACTION_PATTERN.test(clause) &&
    !isReferencedDocsTarget(clause, docsTargetIndex) &&
    !isCoordinatedDocsTarget(clause, docsTargetIndex)
  );
}

function isReferencedDocsTarget(clause: string, docsTargetIndex: number): boolean {
  return DOCS_REFERENCE_PATTERN.test(clause.slice(0, docsTargetIndex));
}

function isCoordinatedDocsTarget(clause: string, docsTargetIndex: number): boolean {
  return /(?:\band|\sи)\s*$/iu.test(clause.slice(0, docsTargetIndex));
}
