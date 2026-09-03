const ENGLISH_NUDGE = String.raw`(?:any\s+)?(?:progress|status|update)|so|how(?:'s|\s+is)\s+it\s+going|where\s+are\s+we|what(?:'s|\s+is)\s+the\s+status|(?:please\s+)?(?:continue|proceed|go\s+on|keep\s+going|carry\s+on)|(?:please\s+)?(?:report|show|give\s+me)\s+(?:the\s+)?(?:progress|status|update)`;
const RUSSIAN_NUDGE = String.raw`(?:ну\s+и\s+)?как\s+(?:успехи|ид[её]т|продвигается)|(?:есть\s+прогресс|какой\s+статус|что\s+со\s+статусом)|(?:статус|прогресс)|(?:пожалуйста[,\s]+)?(?:продолжай|продолжи|работай\s+дальше)|(?:готово|закончено|завершено)|(?:ты\s+)?(?:закончил|закончила|завершил|завершила)`;
const UKRAINIAN_NUDGE = String.raw`(?:ну\s+і\s+)?як\s+(?:успіхи|іде|просувається)|(?:є\s+прогрес|який\s+статус|що\s+зі\s+статусом)|(?:статус|прогрес)|(?:будь\s+ласка[,\s]+)?(?:продовжуй|продовж|працюй\s+далі)|(?:готово|закінчено|завершено)|(?:ти\s+)?(?:закінчив|закінчила|завершив|завершила)`;
const NON_REQUIREMENT_NUDGE_PATTERN = new RegExp(
  String.raw`^(?:${ENGLISH_NUDGE}|${RUSSIAN_NUDGE}|${UKRAINIAN_NUDGE})\s*[?!.…]*$`,
  "iu",
);
const COMPLETION_NUDGE_PATTERN =
  /^are\s+you\s+(?:done|finished)(?:\s+with\s+(?:the\s+)?task)?\s+or\s+is\s+there\s+(?:anything|something)\s+left\s*[?!.]*\s*if\s+you\s+are\s+finished\s*,?\s*(?:ensure|make\s+sure)(?:\s+that)?\s+all\s+requirements\s+(?:are\s+)?(?:satisfied|met)(?:\s+and\s+(?:create|write)\s+[\p{L}\p{N}_./-]+\.(?:adoc|md|mdx|rst|txt))?\s*[?!.]*$/iu;
const TERMINAL_RECOVERY_NUDGE_PATTERN =
  /^finish_notes\.md exists,\s+but p has not completed its terminal verification\.\s+complete fresh verification,\s+then call finish_work with the current verification_token\.$/iu;
const NUDGE_DOCUMENT_PATH_PATTERN = /[\p{L}\p{N}_./-]+\.(?:adoc|md|mdx|rst|txt)\b/giu;

export function isNonRequirementNudge(promptText: string, taskPrompts: readonly { text: string }[]): boolean {
  const normalized = promptText.trim();
  if (NON_REQUIREMENT_NUDGE_PATTERN.test(normalized)) return true;
  if (TERMINAL_RECOVERY_NUDGE_PATTERN.test(normalized)) return taskPrompts.length > 0;
  if (!COMPLETION_NUDGE_PATTERN.test(normalized) || taskPrompts.length === 0) return false;
  const priorText = taskPrompts
    .map((prompt) => prompt.text)
    .join("\n")
    .toLowerCase();
  const mentionedPaths = [...normalized.matchAll(NUDGE_DOCUMENT_PATH_PATTERN)].map((match) => match[0].toLowerCase());
  return mentionedPaths.every((path) => priorText.includes(path));
}
