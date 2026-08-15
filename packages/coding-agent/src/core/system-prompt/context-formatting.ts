export const MAX_FULL_CONTEXT_FILE_CHARS = 6000;
export const MAX_COMPACT_CONTEXT_FILE_CHARS = 6000;
export const RULE_KEYWORD_PATTERN =
  /\b(always|ask|before|block|cannot|commands?|do not|don't|must|never|no \w+|only|required|rules?|run|should|test|use \w+|verify)\b|^\s*(No |Prefer |Avoid |For |Use )/i;

export function formatContextFileForPrompt(filePath: string, content: string): string {
  if (content.length <= MAX_FULL_CONTEXT_FILE_CHARS) {
    return content;
  }

  const selectedLines: string[] = [
    `[Large project rules file compacted from ${content.length} chars.]`,
    `Full rules remain available at ${filePath}; read the file before broad changes or when exact wording matters.`,
    "",
  ];
  let omitted = 0;
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#") || RULE_KEYWORD_PATTERN.test(trimmed)) {
      selectedLines.push(line);
    } else {
      omitted++;
    }
    if (selectedLines.join("\n").length >= MAX_COMPACT_CONTEXT_FILE_CHARS) {
      break;
    }
  }

  if (omitted > 0) {
    selectedLines.push("", `[${omitted} lower-signal lines omitted from prompt context.]`);
  }

  const compacted = selectedLines.join("\n");
  if (compacted.length <= MAX_COMPACT_CONTEXT_FILE_CHARS) {
    return compacted;
  }
  return `${compacted.slice(0, MAX_COMPACT_CONTEXT_FILE_CHARS - 80).trimEnd()}\n[compacted rules truncated to prompt budget]`;
}
