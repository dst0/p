import { getProjectInstructionConstraintSourceText } from "./compiler-source-units.ts";
import { tokenizeProjectInstructionActivity } from "./compiler-validation.ts";
import type {
  ProjectInstructionClassifications,
  ProjectInstructionConstraintInput,
  ProjectInstructionModuleInput,
} from "./types.ts";

const MAX_TRIGGER_CHARS = 180;
const MAX_TRIGGER_TOKEN_CHARS = 40;
const MAX_TOPIC_TERMS = 14;
const ROUTING_TOPIC_TERMS = new Set([
  "api",
  "artifact",
  "auth",
  "benchmark",
  "branch",
  "brotli",
  "build",
  "cache",
  "changelog",
  "check",
  "ci",
  "cli",
  "code",
  "commit",
  "compiler",
  "coverage",
  "credential",
  "credentials",
  "daemon",
  "dependency",
  "deploy",
  "documentation",
  "evidence",
  "file",
  "format",
  "git",
  "github",
  "import",
  "install",
  "javascript",
  "key",
  "lockfile",
  "log",
  "memory",
  "model",
  "npm",
  "package",
  "path",
  "pr",
  "prompt",
  "provider",
  "publish",
  "release",
  "repository",
  "review",
  "rollback",
  "rules",
  "secret",
  "secrets",
  "security",
  "skill",
  "smoke",
  "source",
  "test",
  "testing",
  "token",
  "tool",
  "typescript",
  "version",
  "worktree",
]);

export function deriveProjectInstructionTriggers(
  classifications: ProjectInstructionClassifications,
  modules: ProjectInstructionModuleInput[],
  constraints: ProjectInstructionConstraintInput[],
): Record<string, string> {
  const routedByModule = new Map(
    modules.map((module) => [
      module.id,
      constraints.filter(
        (constraint) => constraint.moduleId === module.id && classifications.constraints[constraint.id] === "routed",
      ),
    ]),
  );
  const sourceTokens = new Map(
    modules.map((module) => [module.id, tokenizeConstraints(routedByModule.get(module.id) ?? [])]),
  );
  const documentFrequency = new Map<string, number>();
  for (const tokens of sourceTokens.values()) {
    for (const token of new Set(tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }
  return Object.fromEntries(
    modules.flatMap((module) => {
      const routed = routedByModule.get(module.id) ?? [];
      if (routed.length === 0) return [];
      return [[module.id, buildTrigger(module, sourceTokens.get(module.id) ?? [], documentFrequency)]];
    }),
  );
}

function buildTrigger(
  module: ProjectInstructionModuleInput,
  sourceTokens: string[],
  documentFrequency: ReadonlyMap<string, number>,
): string {
  if (sourceTokens.length === 0) {
    throw new Error(`Project instruction module has no routable activity terms: ${module.id}`);
  }
  const counts = new Map<string, number>();
  const firstIndexes = new Map<string, number>();
  sourceTokens.forEach((token, index) => {
    counts.set(token, (counts.get(token) ?? 0) + 1);
    if (!firstIndexes.has(token)) firstIndexes.set(token, index);
  });
  const titleTerms = uniqueTokens(module.title);
  const topics = [...counts.keys()]
    .filter((token) => ROUTING_TOPIC_TERMS.has(token))
    .sort(
      (left, right) =>
        Number(ROUTING_TOPIC_TERMS.has(right)) - Number(ROUTING_TOPIC_TERMS.has(left)) ||
        (counts.get(right) ?? 0) - (counts.get(left) ?? 0) ||
        (documentFrequency.get(left) ?? 0) - (documentFrequency.get(right) ?? 0) ||
        (firstIndexes.get(left) ?? 0) - (firstIndexes.get(right) ?? 0),
    )
    .slice(0, MAX_TOPIC_TERMS);
  const selected: string[] = [];
  const selectedSet = new Set<string>();
  const sourceTermSet = new Set(sourceTokens);
  const grounded = titleTerms.find((term) => sourceTermSet.has(term)) ?? topics[0] ?? sourceTokens[0]!;
  for (const token of [grounded, ...titleTerms, ...topics]) {
    appendToken(selected, selectedSet, token);
    if (selected.join(" ").length >= MAX_TRIGGER_CHARS) break;
  }
  return selected.join(" ");
}

function tokenizeConstraints(constraints: ProjectInstructionConstraintInput[]): string[] {
  return constraints.flatMap((constraint) => uniqueTokens(getProjectInstructionConstraintSourceText(constraint)));
}

function uniqueTokens(value: string): string[] {
  const seen = new Set<string>();
  return tokenizeProjectInstructionActivity(value).filter((token) => {
    if (token.length > MAX_TRIGGER_TOKEN_CHARS || seen.has(token)) return false;
    seen.add(token);
    return true;
  });
}

function appendToken(selected: string[], selectedSet: Set<string>, token: string): void {
  if (selectedSet.has(token)) return;
  const nextLength = selected.reduce((total, entry) => total + entry.length, 0) + selected.length + token.length;
  if (nextLength > MAX_TRIGGER_CHARS) return;
  selected.push(token);
  selectedSet.add(token);
}
