import type { RuleSeverity, RuleSource } from "./project-rules.ts";

export function classifySeverity(text: string): RuleSeverity {
  if (/\b(must|never|do not|don't|cannot|required|block|forbidden)\b/i.test(text)) return "critical";
  if (/\b(should|ask|before|verify|test|run)\b/i.test(text)) return "warning";
  return "info";
}

export function severityScore(severity: RuleSeverity): number {
  switch (severity) {
    case "critical":
      return 3;
    case "warning":
      return 2;
    case "info":
      return 1;
  }
}

export function sourceRank(source: RuleSource): number {
  switch (source) {
    case "pdev":
      return 0;
    case "nearest_agents":
      return 1;
    case "repo_agents":
      return 2;
    case "global":
      return 3;
    case "compatibility":
      return 4;
  }
}

export function normalizeRule(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isGuardrailCandidate(text: string): boolean {
  const isDirective = /\b(never|do not|must|required|run|block|before)\b/i.test(text);
  const hasExecutableSurface =
    /\b(npm|pnpm|bun|node|cargo|go|git|commit|push|stage|checkout|reset|clean|stash|apply_patch|lockfile|generated|build|test|lint|typecheck|format|approval|approve|guardrail)\b/i.test(
      text,
    );
  return isDirective && hasExecutableSurface;
}

export function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_.:/-]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
}
