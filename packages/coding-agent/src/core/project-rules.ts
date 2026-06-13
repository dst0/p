import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

const MAX_RULE_FILE_BYTES = 500_000;
const LARGE_RULE_FILE_CHARS = 6000;
const MAX_CONTEXT_TOKENS = 900;
const RULE_KEYWORDS =
	/\b(always|approval|ask|before|block|cannot|check|command|do not|don't|forbidden|must|never|only|required|rule|run|test|verify)\b/i;

export type RuleSource = "pdev" | "nearest_agents" | "repo_agents" | "global" | "compatibility";
export type RuleSeverity = "info" | "warning" | "critical";

export interface RuleSnippet {
	id: string;
	source: RuleSource;
	path: string;
	line: number;
	text: string;
	severity: RuleSeverity;
	topics: string[];
}

export interface RuleIndex {
	cwd: string;
	files: Array<{
		path: string;
		source: RuleSource;
		size: number;
	}>;
	snippets: RuleSnippet[];
}

export interface RuleLintIssue {
	severity: RuleSeverity;
	code: "oversized_file" | "duplicate_rule" | "conflicting_rule" | "guardrail_candidate";
	path?: string;
	line?: number;
	message: string;
}

export interface RuleLintResult {
	index: RuleIndex;
	issues: RuleLintIssue[];
}

export interface RuleExplainResult {
	query: string;
	snippets: RuleSnippet[];
	content: string;
}

export function buildRuleIndex(cwd: string): RuleIndex {
	const files = discoverRuleFiles(cwd);
	const snippets: RuleSnippet[] = [];
	for (const file of files) {
		const text = safeRead(file.path);
		if (!text) continue;
		snippets.push(...extractRuleSnippets(text, file.path, file.source));
	}
	return { cwd, files, snippets };
}

export function createRulesContext(cwd: string, query: string, maxTokens = MAX_CONTEXT_TOKENS): string | undefined {
	const index = buildRuleIndex(cwd);
	const snippets = selectRuleSnippets(index, query);
	if (snippets.length === 0) return undefined;
	return capText(
		[
			"<project_rules>",
			"Automatically selected scoped project rules. Current user instructions still take precedence.",
			...snippets.map(
				(snippet) => `- ${relative(cwd, snippet.path)}:${snippet.line} [${snippet.severity}] ${snippet.text}`,
			),
			"</project_rules>",
		].join("\n"),
		maxTokens,
	);
}

export function lintProjectRules(cwd: string): RuleLintResult {
	const index = buildRuleIndex(cwd);
	const issues: RuleLintIssue[] = [];
	for (const file of index.files) {
		if (file.size > LARGE_RULE_FILE_CHARS) {
			issues.push({
				severity: "warning",
				code: "oversized_file",
				path: file.path,
				message: "Large rules file will be compacted in prompt context; keep critical rules concise.",
			});
		}
	}

	const seen = new Map<string, RuleSnippet>();
	for (const snippet of index.snippets) {
		const normalized = normalizeRule(snippet.text);
		const existing = seen.get(normalized);
		if (existing) {
			issues.push({
				severity: "info",
				code: "duplicate_rule",
				path: snippet.path,
				line: snippet.line,
				message: `Duplicate rule also appears at ${relative(cwd, existing.path)}:${existing.line}.`,
			});
		} else {
			seen.set(normalized, snippet);
		}

		if (isGuardrailCandidate(snippet.text)) {
			issues.push({
				severity: snippet.severity,
				code: "guardrail_candidate",
				path: snippet.path,
				line: snippet.line,
				message: "Rule is concrete enough to enforce as an executable guardrail.",
			});
		}
	}

	const snippets = index.snippets;
	for (let indexA = 0; indexA < snippets.length; indexA++) {
		for (let indexB = indexA + 1; indexB < snippets.length; indexB++) {
			if (rulesConflict(snippets[indexA].text, snippets[indexB].text)) {
				issues.push({
					severity: "warning",
					code: "conflicting_rule",
					path: snippets[indexB].path,
					line: snippets[indexB].line,
					message: `Possible conflict with ${relative(cwd, snippets[indexA].path)}:${snippets[indexA].line}.`,
				});
			}
		}
	}

	return { index, issues };
}

export function explainProjectRules(cwd: string, query: string): RuleExplainResult {
	const index = buildRuleIndex(cwd);
	const snippets = selectRuleSnippets(index, query || "rules");
	const content =
		snippets.length > 0
			? snippets
					.map((snippet) => `${relative(cwd, snippet.path)}:${snippet.line} [${snippet.source}] ${snippet.text}`)
					.join("\n")
			: "No scoped rules matched.";
	return { query, snippets, content };
}

function discoverRuleFiles(cwd: string): Array<{ path: string; source: RuleSource; size: number }> {
	const result: Array<{ path: string; source: RuleSource; size: number }> = [];
	const seen = new Set<string>();
	const add = (path: string, source: RuleSource): void => {
		const resolved = resolve(path);
		if (seen.has(resolved) || !existsSync(resolved)) return;
		const stat = statSync(resolved);
		if (!stat.isFile() || stat.size > MAX_RULE_FILE_BYTES) return;
		seen.add(resolved);
		result.push({ path: resolved, source, size: stat.size });
	};

	const pdevRulesDir = join(cwd, ".pdev", "rules");
	if (existsSync(pdevRulesDir)) {
		for (const entry of readdirSync(pdevRulesDir, { withFileTypes: true })) {
			if (entry.isFile() && entry.name.endsWith(".md")) {
				add(join(pdevRulesDir, entry.name), "pdev");
			}
		}
	}

	const ancestors = getAncestors(cwd);
	const nearest = [...ancestors].reverse().find((dir) => existsSync(join(dir, "AGENTS.md")));
	if (nearest) add(join(nearest, "AGENTS.md"), "nearest_agents");
	const repoRoot = ancestors.find((dir) => existsSync(join(dir, ".git"))) ?? ancestors[0];
	if (repoRoot) add(join(repoRoot, "AGENTS.md"), "repo_agents");
	add(join(homedir(), ".pdev", "AGENTS.md"), "global");

	for (const dir of [...ancestors].reverse()) {
		add(join(dir, "CLAUDE.md"), "compatibility");
		add(join(dir, ".clinerules"), "compatibility");
		const cursorRulesDir = join(dir, ".cursor", "rules");
		if (existsSync(cursorRulesDir)) {
			for (const entry of readdirSync(cursorRulesDir, { withFileTypes: true })) {
				if (entry.isFile() && entry.name.endsWith(".md")) {
					add(join(cursorRulesDir, entry.name), "compatibility");
				}
			}
		}
	}

	return result;
}

function getAncestors(cwd: string): string[] {
	const result: string[] = [];
	let current = resolve(cwd);
	while (true) {
		result.unshift(current);
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return result;
}

function safeRead(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
}

function extractRuleSnippets(content: string, path: string, source: RuleSource): RuleSnippet[] {
	const snippets: RuleSnippet[] = [];
	let currentHeading = "";
	content.split("\n").forEach((rawLine, index) => {
		const line = rawLine.trim();
		if (!line) return;
		if (line.startsWith("#")) {
			currentHeading = line.replace(/^#+\s*/, "").trim();
		}
		if (!line.startsWith("#") && !line.startsWith("-") && !RULE_KEYWORDS.test(line)) return;
		const text = line.replace(/^[-*]\s*/, "").trim();
		if (!text || text === currentHeading) return;
		const topics = tokenize(`${currentHeading} ${text}`).slice(0, 12);
		snippets.push({
			id: stableId(`${path}:${index + 1}:${text}`),
			source,
			path,
			line: index + 1,
			text,
			severity: classifySeverity(text),
			topics,
		});
	});
	return snippets;
}

function selectRuleSnippets(index: RuleIndex, query: string): RuleSnippet[] {
	const terms = tokenize(query);
	const scored = index.snippets
		.map((snippet) => ({
			snippet,
			score: terms.length === 0 ? severityScore(snippet.severity) : scoreSnippet(snippet, terms),
		}))
		.filter((item) => item.score > 0)
		.sort((a, b) => b.score - a.score || sourceRank(a.snippet.source) - sourceRank(b.snippet.source));
	return scored.slice(0, 10).map((item) => item.snippet);
}

function scoreSnippet(snippet: RuleSnippet, terms: string[]): number {
	const text = `${snippet.text} ${snippet.topics.join(" ")}`.toLowerCase();
	let score = severityScore(snippet.severity);
	for (const term of terms) {
		if (text.includes(term)) score += 3;
	}
	return score;
}

function classifySeverity(text: string): RuleSeverity {
	if (/\b(must|never|do not|don't|cannot|required|block|forbidden)\b/i.test(text)) return "critical";
	if (/\b(should|ask|before|verify|test|run)\b/i.test(text)) return "warning";
	return "info";
}

function severityScore(severity: RuleSeverity): number {
	switch (severity) {
		case "critical":
			return 3;
		case "warning":
			return 2;
		case "info":
			return 1;
	}
}

function sourceRank(source: RuleSource): number {
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

function normalizeRule(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

function isGuardrailCandidate(text: string): boolean {
	const isDirective = /\b(never|do not|must|required|run|block|before)\b/i.test(text);
	const hasExecutableSurface =
		/\b(npm|pnpm|bun|node|cargo|go|git|commit|push|stage|checkout|reset|clean|stash|apply_patch|lockfile|generated|build|test|lint|typecheck|format|approval|approve|guardrail)\b/i.test(
			text,
		);
	return isDirective && hasExecutableSurface;
}

function rulesConflict(a: string, b: string): boolean {
	const normalizedA = normalizeRule(a);
	const normalizedB = normalizeRule(b);
	const aNever = /\b(never|do not|don't|cannot)\b/i.test(a);
	const bNever = /\b(never|do not|don't|cannot)\b/i.test(b);
	const aAlways = /\b(always|must|required)\b/i.test(a);
	const bAlways = /\b(always|must|required)\b/i.test(b);
	if (aNever === bNever || aAlways === bAlways) return false;
	const termsA = new Set(tokenize(normalizedA).filter((term) => term.length > 3));
	const overlap = tokenize(normalizedB).filter((term) => termsA.has(term)).length;
	return overlap >= 3;
}

function tokenize(value: string): string[] {
	return value
		.toLowerCase()
		.split(/[^a-z0-9_.:/-]+/i)
		.map((term) => term.trim())
		.filter((term) => term.length > 0);
}

function capText(text: string, maxTokens: number): string {
	const maxChars = Math.max(300, maxTokens * 4);
	return text.length <= maxChars ? text : `${text.slice(0, maxChars - 14).trimEnd()}\n[truncated]`;
}

function stableId(text: string): string {
	let hash = 2166136261;
	for (let index = 0; index < text.length; index++) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return `rule-${(hash >>> 0).toString(16)}`;
}
