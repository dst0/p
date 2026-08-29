function singleLine(value: unknown): string {
  return String(value ?? "").replaceAll(/\s*[\r\n]+\s*/gu, " ");
}

export function escapeMarkdownText(value: unknown): string {
  return singleLine(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll(/\b(https?|ftp):/giu, "$1&#58;")
    .replaceAll(/([\\`*_[\]{}()#+!|~])/gu, "\\$1");
}

export function escapeMarkdownTableCell(value: unknown): string {
  return escapeMarkdownText(value);
}

export function markdownCodeSpan(value: unknown): string {
  const content = singleLine(value);
  if (content.length === 0) return "<code></code>";
  const longestRun = Math.max(0, ...(content.match(/`+/gu) ?? []).map((run) => run.length));
  const delimiter = "`".repeat(longestRun + 1);
  const padding = /^[ `]|[ `]$/u.test(content) ? " " : "";
  return `${delimiter}${padding}${content}${padding}${delimiter}`;
}
