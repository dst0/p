/** A registered but currently-deferred (inactive) tool the model can discover through tool_search. */
export interface DeferredToolCatalogEntry {
  name: string;
  description: string;
}

const ENTRY_DESCRIPTION_MAX_CHARS = 60;
const CATALOG_MAX_CHARS = 600;

/**
 * Compact catalog of deferred extension/MCP tools so the model knows they exist without paying for
 * their full schema or promptSnippet. Full "name — description" entries are added until the total
 * character budget is spent; any remaining tools are still named (never silently hidden) in a trailing
 * names-only line.
 */
export function formatDeferredToolsCatalog(
  entries: readonly DeferredToolCatalogEntry[],
  maxChars = CATALOG_MAX_CHARS,
): string | undefined {
  if (entries.length === 0) return undefined;
  const lines: string[] = [];
  let used = 0;
  let index = 0;
  for (; index < entries.length; index++) {
    const { name, description } = entries[index]!;
    const summary =
      description.length > ENTRY_DESCRIPTION_MAX_CHARS
        ? `${description.slice(0, ENTRY_DESCRIPTION_MAX_CHARS).trimEnd()}…`
        : description;
    const line = `- ${name} — ${summary}`;
    if (lines.length > 0 && used + line.length + 1 > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  const remainingNames = entries.slice(index).map((entry) => entry.name);
  if (remainingNames.length > 0) {
    lines.push(`- Also available via tool_search: ${remainingNames.join(", ")}`);
  }
  return lines.join("\n");
}
