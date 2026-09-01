import { normalizeText } from "./tool-classification.ts";

export const MAX_COMPLETION_CHECKLIST_ITEMS = 12;
export const MAX_COMPLETION_CHECKLIST_CHARS = 1_200;

const PROCESS_ONLY_PATTERN =
  /^\s*(?:(?:all|the|requested)\s+)?(?:(?:unit|integration|focused|full|typescript)\s+)?(?:tests?|test\s+suite|type[- ]?check|lint|build|npm\s+run\s+check|source\s+files?|modules?)\s+(?:all\s+)?(?:pass(?:es|ed)?|succeed(?:s|ed)?|complete|exist|green)\s*[.!]?\s*$/iu;

export function validatedCompletionChecklist(value: unknown): string[] | string {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_COMPLETION_CHECKLIST_ITEMS) {
    return `completion_checklist requires 1-${MAX_COMPLETION_CHECKLIST_ITEMS} concise behavioral items.`;
  }
  if (!value.every((item) => typeof item === "string")) return "Every completion_checklist item must be text.";
  const normalized = value.map(normalizeText).filter(Boolean);
  if (normalized.length !== value.length) return "Every completion_checklist item must be non-empty.";
  if (normalized.some((item) => item.length > 300)) {
    return "Each completion_checklist item must fit within 300 characters.";
  }
  if (normalized.join("\n").length > MAX_COMPLETION_CHECKLIST_CHARS) {
    return `completion_checklist must fit within ${MAX_COMPLETION_CHECKLIST_CHARS} characters.`;
  }
  if (new Set(normalized.map((item) => item.toLocaleLowerCase("en-US"))).size !== normalized.length) {
    return "completion_checklist contains duplicate criteria.";
  }
  const processOnlyCriterion = normalized.find((criterion) => PROCESS_ONLY_PATTERN.test(criterion));
  return processOnlyCriterion
    ? `completion_checklist item "${processOnlyCriterion}" must describe observable requested behavior or a requested artifact; passing tests, typechecks, builds, or generic file completion are evidence rather than the behavior itself.`
    : normalized;
}

export function persistedCompletionChecklistIsCanonical(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  const validated = validatedCompletionChecklist(value);
  return Array.isArray(validated) && validated.every((item, index) => item === value[index]);
}
