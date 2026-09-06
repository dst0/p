import { MAX_COMPLETION_CHECKLIST_INPUT_ITEMS } from "./constants.ts";
import { normalizeText } from "./tool-classification.ts";

export const MAX_COMPLETION_CHECKLIST_ITEMS = 12;
export const MAX_COMPLETION_CHECKLIST_CHARS = 1_200;

const PROCESS_SUBJECT = String.raw`(?:(?:all|the|requested|existing)\s+)*(?:(?:unit|integration|focused|full|typescript)\s+)?(?:(?:tests?|test\s+suite)(?:\s+files?)?|type[- ]?checks?|lint|build|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:check|test(?::[\w:-]+)?|type[- ]?check|lint|build)|source\s+files?|modules?)(?:\s+(?:cases?|suite))?`;
const PROCESS_RESULT = String.raw`(?:(?:all|both)\s+)?(?:(?:should|must)\s+)?(?:pass(?:es|ed)?|succeed(?:s|ed)?|complete|exist|green|(?:is|are)\s+(?:complete|green|successful))(?:\s+(?:without\s+failures?|with\s+no\s+failures?))?`;
const PROCESS_CONJUNCTION = String.raw`\s*(?:,\s*(?:and\s+)?|and\s+|&\s*)`;
const PROCESS_ONLY_PATTERN = new RegExp(
  String.raw`^\s*(?:${PROCESS_SUBJECT}(?:${PROCESS_CONJUNCTION}${PROCESS_SUBJECT})*\s+${PROCESS_RESULT}|${PROCESS_SUBJECT}\s+${PROCESS_RESULT}(?:${PROCESS_CONJUNCTION}${PROCESS_SUBJECT}\s+${PROCESS_RESULT})+)\s*(?:\([^\n)]*\))?\s*[.!]?\s*$`,
  "iu",
);

export function validatedCompletionChecklist(value: unknown): string[] | string {
  if (!Array.isArray(value) || value.length === 0) {
    return `completion_checklist requires 1-${MAX_COMPLETION_CHECKLIST_ITEMS} concise behavioral items.`;
  }
  if (value.length > MAX_COMPLETION_CHECKLIST_INPUT_ITEMS) {
    return `completion_checklist input accepts at most ${MAX_COMPLETION_CHECKLIST_INPUT_ITEMS} items before process-only evidence is removed.`;
  }
  if (!value.every((item) => typeof item === "string")) return "Every completion_checklist item must be text.";
  const normalized = value.map(normalizeText).filter(Boolean);
  if (normalized.length !== value.length) return "Every completion_checklist item must be non-empty.";
  const behavioral = normalized.filter((criterion) => !PROCESS_ONLY_PATTERN.test(criterion));
  if (behavioral.length === 0) {
    const processOnlyCriterion = normalized[0]!;
    return `completion_checklist item "${processOnlyCriterion}" must describe observable requested behavior or a requested artifact; passing tests, typechecks, builds, or generic file completion are evidence rather than the behavior itself.`;
  }
  if (behavioral.length > MAX_COMPLETION_CHECKLIST_ITEMS) {
    return `completion_checklist requires 1-${MAX_COMPLETION_CHECKLIST_ITEMS} concise behavioral items.`;
  }
  if (behavioral.some((item) => item.length > 300)) {
    return "Each completion_checklist item must fit within 300 characters.";
  }
  if (behavioral.join("\n").length > MAX_COMPLETION_CHECKLIST_CHARS) {
    return `completion_checklist must fit within ${MAX_COMPLETION_CHECKLIST_CHARS} characters. Omit unselected source clauses; do not shorten selected behaviors by dropping semantic qualifiers.`;
  }
  if (new Set(behavioral.map((item) => item.toLocaleLowerCase("en-US"))).size !== behavioral.length) {
    return "completion_checklist contains duplicate criteria.";
  }
  return behavioral;
}

export function persistedCompletionChecklistIsCanonical(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  const validated = validatedCompletionChecklist(value);
  return (
    Array.isArray(validated) &&
    validated.length === value.length &&
    validated.every((item, index) => item === value[index])
  );
}
