const PENDING_RULE_GATE_BLOCK = /Call read_rules with each selected authoritative batch/u;

export function parsePendingRuleBatches(text: string): string[][] {
  if (!PENDING_RULE_GATE_BLOCK.test(text)) return [];
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value) => {
      const batch = value && typeof value === "object" ? (value as { links?: unknown }) : undefined;
      const batchLinks = batch?.links;
      if (!Array.isArray(batchLinks)) return [];
      const links = batchLinks.filter(
        (link): link is string => typeof link === "string" && /^rules\/[a-z0-9./-]+$/u.test(link),
      );
      return links.length > 0 && links.length <= 3 && links.length === batchLinks.length ? [links] : [];
    });
  } catch {
    return [];
  }
}
