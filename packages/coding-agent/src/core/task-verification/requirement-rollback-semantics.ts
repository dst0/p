const ROLLBACK_OPERATION_PATTERN =
  /\b(?:(?:after|during|on|upon)\s+(?:an?\s+|the\s+)?rollback|(?:execute(?:s|d|ing)?|invok(?:e|es|ed|ing)|perform(?:s|ed|ing)?|run(?:s|ning)?|trigger(?:s|ed|ing)?)\s+(?:an?\s+|the\s+)?rollback|rolls?\s+back|rolled\s+back|rolling\s+back|rollback\s+(?:(?:(?:can|could|may|might|must|shall|should|will|would)\s+be|has\s+been|had\s+been|is|was)\s+(?:executed|invoked|performed|triggered)|(?:(?:must|shall|should|will)\s+)?(?:keep\w*|leav\w*|occurs?|preserv\w*|restor\w*|revert\w*)))\b/iu;
const STATIC_ROLLBACK_FIELD_PATTERN =
  /\b(?:rollback\s+(?:config\s+)?(?:field|key|label|property|text|value)|(?:field|key|label|property)\s+(?:named\s+)?rollback)\b/iu;
const STATIC_ROLLBACK_PROPERTY_PATTERN = /(?:"rollback"|'rollback'|\brollback\b)\s*:/iu;
const QUOTED_ROLLBACK_PROPERTY_VALUE_PATTERN =
  /(?:(?:"rollback"|'rollback'|\brollback\b)\s*:\s*"(?:\\.|[^"\\])*"|(?:"rollback"|'rollback'|\brollback\b)\s*:\s*'(?:\\.|[^'\\])*')/giu;
const UNQUOTED_ROLLBACK_PROPERTY_VALUE_PATTERN = /(?:^|\n)\s*rollback\s*:\s*[^\n"'][^\n]*/giu;
const ROLLBACK_TERM_PATTERN = /\brollback\w*\b/giu;

export function hasRollbackOperationSemantics(value: string): boolean {
  return ROLLBACK_OPERATION_PATTERN.test(value);
}

export function hasStaticRollbackMetadata(value: string): boolean {
  return STATIC_ROLLBACK_FIELD_PATTERN.test(value) || STATIC_ROLLBACK_PROPERTY_PATTERN.test(value);
}

export function withoutStaticRollbackPropertyValues(value: string): string {
  return value
    .replace(QUOTED_ROLLBACK_PROPERTY_VALUE_PATTERN, "")
    .replace(UNQUOTED_ROLLBACK_PROPERTY_VALUE_PATTERN, "");
}

export function withoutRollbackTerms(value: string): string {
  return value.replace(ROLLBACK_TERM_PATTERN, "");
}
