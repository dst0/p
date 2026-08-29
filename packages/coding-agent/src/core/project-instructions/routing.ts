import { PROJECT_INSTRUCTIONS_PROMPT_BUDGET } from "./limits.ts";
import type {
  PreparedProjectInstructions,
  ProjectInstructionRuleRecord,
  ProjectInstructionTurnRoutes,
} from "./types.ts";
import { inferProjectInstructionPhases, inferProjectInstructionRulePhases } from "./work-phases.ts";

const MAX_SELECTED_RULES = 3;
const MIN_TOKEN_LENGTH = 2;
const TITLE_TERM_WEIGHT = 8;
const TRIGGER_TERM_WEIGHT = 2;
const ROUTING_TOKEN_ALIASES = new Map([
  ["began", "start"],
  ["begin", "start"],
  ["beginning", "start"],
  ["branches", "branch"],
  ["checked", "check"],
  ["checking", "check"],
  ["checks", "check"],
  ["commands", "command"],
  ["commits", "commit"],
  ["committed", "commit"],
  ["committing", "commit"],
  ["dependencies", "dependency"],
  ["deployed", "deploy"],
  ["deploying", "deploy"],
  ["deployment", "deploy"],
  ["deployments", "deploy"],
  ["diagnosis", "diagnose"],
  ["diagnostic", "diagnose"],
  ["diagnostics", "diagnose"],
  ["finished", "finish"],
  ["finishes", "finish"],
  ["finishing", "finish"],
  ["implementation", "implement"],
  ["implemented", "implement"],
  ["implementing", "implement"],
  ["inspection", "inspect"],
  ["inspecting", "inspect"],
  ["installation", "install"],
  ["installed", "install"],
  ["installing", "install"],
  ["issues", "issue"],
  ["learnings", "learning"],
  ["packages", "package"],
  ["prs", "pr"],
  ["published", "publish"],
  ["publishes", "publish"],
  ["publishing", "publish"],
  ["released", "release"],
  ["releases", "release"],
  ["releasing", "release"],
  ["repositories", "repository"],
  ["reviewed", "review"],
  ["reviewing", "review"],
  ["reviews", "review"],
  ["summaries", "summary"],
  ["summarize", "summary"],
  ["summarized", "summary"],
  ["summarizing", "summary"],
  ["tested", "test"],
  ["testing", "test"],
  ["tests", "test"],
  ["verification", "verify"],
  ["verified", "verify"],
  ["verifying", "verify"],
  ["versions", "version"],
]);
const ROUTING_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "applies",
  "are",
  "as",
  "at",
  "be",
  "before",
  "by",
  "for",
  "from",
  "involving",
  "is",
  "of",
  "on",
  "or",
  "project",
  "request",
  "requests",
  "rule",
  "rules",
  "task",
  "tasks",
  "that",
  "the",
  "these",
  "this",
  "those",
  "to",
  "user",
  "when",
  "with",
  "without",
  "work",
]);

export function selectProjectInstructionRuleLinks(
  rules: readonly ProjectInstructionRuleRecord[],
  query: string,
): string[] {
  const routableRules = rules.filter((rule) => rule.routable);
  const queryPhases = new Set(inferProjectInstructionPhases(query));
  const triggerFrequency = new Map<string, number>();
  for (const rule of routableRules) {
    for (const term of new Set(tokenize(rule.trigger))) {
      triggerFrequency.set(term, (triggerFrequency.get(term) ?? 0) + 1);
    }
  }
  const maximumUsefulFrequency = Math.max(1, Math.ceil(routableRules.length / 2));
  const queryTerms = new Set(expandRoutingQueryTerms(tokenize(query)));
  const triggerQueryTerms = new Set(
    [...queryTerms].filter((term) => (triggerFrequency.get(term) ?? 0) <= maximumUsefulFrequency),
  );
  if (queryTerms.size === 0 && queryPhases.size === 0) return [];
  const scored = routableRules.map((rule, index) => ({
    rule,
    index,
    ...scoreRule(rule, query, queryTerms, triggerQueryTerms, queryPhases),
  }));
  const lexicalMatches = scored.filter(({ lexicalScore }) => lexicalScore > 0);
  const useLexicalMatches = lexicalMatches.length > 0;
  const candidates = useLexicalMatches ? lexicalMatches : scored.filter(({ phaseScore }) => phaseScore > 0);
  return candidates
    .sort(
      (left, right) =>
        (useLexicalMatches
          ? right.lexicalScore - left.lexicalScore || right.phaseScore - left.phaseScore
          : right.phaseScore - left.phaseScore) ||
        left.index - right.index ||
        left.rule.link.localeCompare(right.rule.link),
    )
    .slice(0, MAX_SELECTED_RULES)
    .map(({ rule }) => rule.link);
}

export function matchesProjectInstructionRuleBatch(
  selectedLinks: readonly string[],
  suppliedLinks: readonly string[],
): boolean {
  if (selectedLinks.length !== suppliedLinks.length || new Set(suppliedLinks).size !== suppliedLinks.length) {
    return false;
  }
  const selected = new Set(selectedLinks);
  return suppliedLinks.every((link) => selected.has(link));
}

export function renderProjectInstructionTurnContext(
  prepared: PreparedProjectInstructions,
  query: string,
): ProjectInstructionTurnRoutes | undefined {
  if (prepared.manifest.mode === "exact") return undefined;
  const links = selectProjectInstructionRuleLinks(prepared.manifest.rules, query);
  if (links.length === 0) return undefined;
  const rulesByLink = new Map(prepared.manifest.rules.map((rule) => [rule.link, rule]));
  const prompt = renderRoutePrompt(
    prepared.manifest.inputHash,
    links.map((link) => ({ link, trigger: rulesByLink.get(link)?.trigger ?? "Matching project work" })),
  );
  if (prepared.prompt.length + prompt.length > PROJECT_INSTRUCTIONS_PROMPT_BUDGET) {
    throw new Error("Selected project instruction routes exceed the complete injected prompt budget");
  }
  return { links, prompt, inputHash: prepared.manifest.inputHash };
}

export function getMaximumProjectInstructionTurnContextLength(
  rules: readonly ProjectInstructionRuleRecord[],
  inputHash: string,
): number {
  const longestRoutes = rules
    .filter((rule) => rule.routable)
    .map(({ link, trigger }) => ({ link, trigger }))
    .sort((left, right) => renderRouteLine(right).length - renderRouteLine(left).length)
    .slice(0, MAX_SELECTED_RULES);
  return longestRoutes.length === 0 ? 0 : renderRoutePrompt(inputHash, longestRoutes).length;
}

function renderRoutePrompt(inputHash: string, routes: Array<{ link: string; trigger: string }>): string {
  return [
    `<project_rule_routes input_sha256="${inputHash}">`,
    "Candidate links only. The first potentially mutating action will provide the sole authoritative 1-3-link read_rules batch.",
    ...routes.map(renderRouteLine),
    "</project_rule_routes>",
  ].join("\n");
}

function renderRouteLine(route: { link: string; trigger: string }): string {
  return `- \`${route.link}\`: ${singleLine(route.trigger, 180)}`;
}

function scoreRule(
  rule: ProjectInstructionRuleRecord,
  query: string,
  queryTerms: ReadonlySet<string>,
  triggerQueryTerms: ReadonlySet<string>,
  queryPhases: ReadonlySet<string>,
): { lexicalScore: number; phaseScore: number } {
  if (query.includes(rule.link) || query.includes(rule.id)) {
    return { lexicalScore: Number.MAX_SAFE_INTEGER, phaseScore: 0 };
  }
  const titleTerms = new Set(tokenize(rule.title));
  const triggerTerms = new Set(tokenize(rule.trigger));
  let lexicalScore = 0;
  for (const term of queryTerms) {
    if (titleTerms.has(term)) lexicalScore += TITLE_TERM_WEIGHT;
  }
  for (const term of triggerQueryTerms) {
    if (triggerTerms.has(term)) lexicalScore += TRIGGER_TERM_WEIGHT;
  }
  let phaseScore = 0;
  for (const phase of inferProjectInstructionRulePhases(rule)) {
    if (queryPhases.has(phase)) phaseScore += 3;
  }
  return { lexicalScore, phaseScore };
}

function tokenize(value: string): string[] {
  const raw =
    value
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  const normalized: string[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] === "pull" && /^requests?$/u.test(raw[index + 1] ?? "")) {
      normalized.push("pr");
      index += 1;
    } else {
      const token = raw[index]!;
      normalized.push(ROUTING_TOKEN_ALIASES.get(token) ?? token);
    }
  }
  return normalized.filter(
    (token) => (token.length >= MIN_TOKEN_LENGTH || /^\p{N}+$/u.test(token)) && !ROUTING_STOP_WORDS.has(token),
  );
}

function expandRoutingQueryTerms(tokens: string[]): string[] {
  const expanded = new Set(tokens);
  if (expanded.has("release") || expanded.has("publish")) {
    expanded.add("changelog");
    expanded.add("release");
    expanded.add("version");
  }
  if (expanded.has("deploy")) {
    expanded.add("baseline");
    expanded.add("delivery");
    expanded.add("release");
  }
  if (expanded.has("test")) expanded.add("command");
  if (expanded.has("finish") || expanded.has("summary")) expanded.add("learning");
  if (expanded.has("start")) expanded.add("baseline");
  if (expanded.has("install")) expanded.add("dependency");
  return [...expanded];
}

function singleLine(value: string, maxChars: number): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}
