import { createHmac } from "node:crypto";

export const ORDINARY_HEADER = /^Requirement definition has (\d+) deterministic validation errors:\s*$/u;
export const BOUNDED_HEADER =
  /^Requirement definition has (\d+) deterministic validation errors across (\d+) repair classes;/u;
export const NUMBERED_DIAGNOSTIC = /^\d+\.\s+(.*)$/u;
export const GROUPED_DIAGNOSTIC = /^\[(\d+)\s+instances?\]\s+(.*)$/u;

export const CLASS_PATTERNS: Array<readonly [string, RegExp]> = [
  ["unsupported_type", /has an unsupported type\./u],
  ["missing_text", /needs concrete text and acceptance_criterion\./u],
  ["compound", /is compound:/u],
  ["duplicate_requirement", /Duplicate requirement:/u],
  ["invalid_prompt_index", /references an invalid source_prompt_index\./u],
  ["invalid_clause_id", /references an invalid source_clause_id\./u],
  ["invalid_facet_id", /references an invalid source_facet_id\./u],
  ["multiple_facets", /maps multiple source facets/u],
  ["missing_facet_mapping", /maps faceted source clauses without source_facet_ids:/u],
  ["unsafe_mapped_clause", /is an unsafe delegated instruction/u],
  ["clause_prompt_mismatch", /maps source clause .* without its source_prompt_index\./u],
  ["polarity_reversal", /has behavioral polarity that the mapped requirement reverses\./u],
  ["semantic_mismatch", /does not semantically support the mapped requirement\./u],
  ["facet_constraint", /Source facet .* is missing/u],
  ["referenced_source_mapping", /must map every referenced-file source index/u],
  ["invalid_ignored_clause", /Ignored source clause .* is invalid or lacks a reason\./u],
  ["unsafe_classification_required", /must use classification unsafe_instruction\./u],
  ["unsafe_classification_invalid", /cannot use unsafe_instruction\./u],
  ["normative_informational", /cannot be ignored as informational\./u],
  ["invalid_example", /cannot be ignored as example\.|is not structurally an example\./u],
  ["invalid_supersession_field", /may name superseded_by_source_prompt_index only/u],
  ["invalid_supersession_index", /requires a direct user prompt index\./u],
  ["invalid_supersession", /does not conflict with or supersede source clause/u],
  ["mapped_and_ignored_clause", /cannot be both mapped and ignored\./u],
  ["duplicate_ignored_clause", /Source clause .* is ignored twice\./u],
  ["unclassified_clause", /unclassified source_clause_ids:/u],
  ["uncovered_concept", /has uncovered normative concepts?:/u],
  ["uncovered_facet", /has uncovered source facets:/u],
  ["derived_proof_boundary", /newline-terminated artifact that rejects truncation/u],
  ["invalid_ignored_prompt", /Ignored source prompt .* is invalid or lacks a reason\./u],
  ["referenced_prompt_ignored", /Referenced requirement source .* cannot be ignored\./u],
  ["duplicate_ignored_prompt", /Source prompt .* is ignored twice\./u],
  ["referenced_and_ignored_prompt", /Source prompt .* cannot be both referenced and ignored\./u],
  ["unclassified_prompt", /unclassified indexes:/u],
];

export type DiagnosticLineage = {
  resolved: number | null;
  persisting: number | null;
  introduced: number | null;
  complete: boolean;
};

export type DiagnosticFingerprint = {
  hmacSha256: string;
  count: number;
};

export type DiagnosticSet = {
  total: number | null;
  complete: boolean;
  fingerprints: Map<string, number>;
  classes: Record<string, number>;
};

type DiagnosticEntry = { text: string; count: number };

export function normalizedDiagnostic(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ")
    .replace(/\bRequirement\s+\d+\b/giu, "Requirement #")
    .replace(/\s+/gu, " ")
    .trim();
}

export function diagnosticClass(value: string): string {
  return CLASS_PATTERNS.find((entry) => entry[1].test(value))?.[0] ?? "other";
}

export function diagnosticSet(message: unknown, hasRevision: boolean, fingerprintKey: Buffer): DiagnosticSet {
  const lines = String(message ?? "").split(/\r?\n/u);
  const ordinary = lines[0]?.match(ORDINARY_HEADER);
  const bounded = lines[0]?.match(BOUNDED_HEADER);
  const entries: DiagnosticEntry[] = [];
  for (const line of lines.slice(ordinary || bounded ? 1 : 0)) {
    const numbered = line.match(NUMBERED_DIAGNOSTIC)?.[1];
    if (!numbered) continue;
    const grouped = numbered.match(GROUPED_DIAGNOSTIC);
    entries.push({ text: grouped?.[2] ?? numbered, count: grouped ? Number(grouped[1]) : 1 });
  }
  if (!ordinary && !bounded && hasRevision && String(message ?? "").trim()) {
    entries.push({ text: String(message), count: 1 });
  }
  const total = ordinary ? Number(ordinary[1]) : bounded ? Number(bounded[1]) : hasRevision ? entries.length : null;
  const complete = total !== null && !bounded && entries.reduce((sum, entry) => sum + entry.count, 0) === total;
  const fingerprintCounts = new Map<string, number>();
  const classCounts = new Map<string, number>();
  for (const entry of entries) {
    const normalized = normalizedDiagnostic(entry.text);
    const fingerprint = createHmac("sha256", fingerprintKey).update(normalized).digest("hex");
    fingerprintCounts.set(fingerprint, (fingerprintCounts.get(fingerprint) ?? 0) + entry.count);
    const category = diagnosticClass(normalized);
    classCounts.set(category, (classCounts.get(category) ?? 0) + entry.count);
  }
  return {
    total,
    complete,
    fingerprints: new Map([...fingerprintCounts].sort(([left], [right]) => left.localeCompare(right))),
    classes: Object.fromEntries([...classCounts].sort(([left], [right]) => left.localeCompare(right))),
  };
}

export function lineage(previous: DiagnosticSet, current: DiagnosticSet): DiagnosticLineage {
  let resolved = 0;
  let persisting = 0;
  let introduced = 0;
  for (const [hash, count] of previous.fingerprints) {
    const next = current.fingerprints.get(hash) ?? 0;
    persisting += Math.min(count, next);
    resolved += Math.max(0, count - next);
  }
  for (const [hash, count] of current.fingerprints) {
    introduced += Math.max(0, count - (previous.fingerprints.get(hash) ?? 0));
  }
  return { resolved, persisting, introduced, complete: previous.complete && current.complete };
}
