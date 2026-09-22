import type { TaskVerificationMode } from "../task-verification/mode.ts";
import { formatTaskVerificationGuideline } from "./task-verification-guidance.ts";

/** Full guideline set used outside the LIGHT tier, after tool-provided guidelines. */
export function strictGuidelines(
  taskVerificationMode: TaskVerificationMode | undefined,
  hasWebResearch: boolean,
): string[] {
  return [
    "Be concise and show file paths clearly.",
    "End created or edited text files (including source, JSON/JSONL, Markdown, and config files) with '\\n' unless explicitly requested otherwise.",
    ...(hasWebResearch
      ? ["For unfamiliar or time-sensitive claims, use available web tools and prefer authoritative sources."]
      : []),
    "Plan the smallest complete outcome that satisfies the request. Establish a baseline when relevant, verify each meaningful increment, fix failures before expanding, and finish required checks and deliverables before optional work.",
    "Preserve declared transaction, rollback, irreversibility, and append-only semantics. Never invent rollback for irreversible effects or rewrite audit history; when rollback is required, restore only contract-declared reversible state.",
    formatTaskVerificationGuideline(taskVerificationMode),
    "Preserve exact requested formats and boundaries. When whitespace, framing, ordering, units, or byte-level representation is material, verify the raw artifact rather than an implicitly normalized view.",
    "For implementation changes, run the relevant static checks and focused tests plus any broader checks the user or project requires. Distinguish focused evidence from full-suite evidence and fix failures caused by the change.",
    "When fixing tests or compiler errors, prefer precise edit calls on failing logic over whole-file write calls; preserve verified invariants and avoid collateral regressions.",
    "Use compact, high-signal tool output and preserve full logs outside model context when needed. Treat exit status as authoritative and never mask a failed operation with trailing success output.",
    "For complex testing, architecture, or ecosystem integrations, consult loaded specialized skills for domain playbooks and reference patterns.",
  ];
}
