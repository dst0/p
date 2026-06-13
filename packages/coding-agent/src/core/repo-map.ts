import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";

const REPO_MAP_VERSION = 1;
const REPO_MAP_FILE = ".pdev/state/repo-map.json";
const MAX_FILES = 400;
const MAX_FILE_BYTES = 200_000;
const MAX_CONTEXT_TOKENS = 900;
const INDEX_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set([".git", ".pdev", "node_modules", "dist", "build", "coverage", ".next", ".cache"]);

export interface SymbolRef {
	name: string;
	kind: "function" | "class" | "interface" | "type" | "const" | "export";
	signature?: string;
}

export interface RepoMapFile {
	path: string;
	language: string;
	imports: string[];
	exports: SymbolRef[];
	summary: string;
	lastIndexedSha: string;
}

export interface RepoMap {
	version: number;
	root: string;
	indexedAt: string;
	lastIndexedSha: string;
	worktreeFingerprint: string;
	files: RepoMapFile[];
}

export interface RepoMapContext {
	query: string;
	content: string;
	files: RepoMapFile[];
}

export function buildRepoMap(root: string): RepoMap {
	const sha = getGitSha(root);
	const worktreeFingerprint = getWorktreeFingerprint(root);
	const files = listIndexableFiles(root).map((path) => indexFile(root, path, sha));
	return {
		version: REPO_MAP_VERSION,
		root,
		indexedAt: new Date().toISOString(),
		lastIndexedSha: sha,
		worktreeFingerprint,
		files,
	};
}

export function updateRepoMap(root: string): RepoMap {
	const map = buildRepoMap(root);
	const path = join(root, REPO_MAP_FILE);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(map, undefined, 2)}\n`);
	return map;
}

export function readRepoMap(root: string): RepoMap | undefined {
	const path = join(root, REPO_MAP_FILE);
	if (!existsSync(path)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		return isRepoMap(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

export function getOrUpdateRepoMap(root: string): RepoMap {
	const existing = readRepoMap(root);
	const sha = getGitSha(root);
	const worktreeFingerprint = getWorktreeFingerprint(root);
	if (existing?.lastIndexedSha === sha && existing.worktreeFingerprint === worktreeFingerprint) {
		return existing;
	}
	return updateRepoMap(root);
}

export function createRepoMapContext(
	root: string,
	query: string,
	maxTokens = MAX_CONTEXT_TOKENS,
): RepoMapContext | undefined {
	const map = getOrUpdateRepoMap(root);
	const terms = tokenize(query);
	if (terms.length === 0) return undefined;
	const scored = map.files
		.map((file) => ({ file, score: scoreFile(file, terms) }))
		.filter((item) => item.score > 0)
		.sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path))
		.slice(0, 8);
	if (scored.length === 0) return undefined;
	const lines = [
		"<repo_map>",
		"Automatically selected repo-map snippets. Read exact files before editing.",
		...scored.map(({ file }) => {
			const exports =
				file.exports
					.slice(0, 8)
					.map((symbol) => symbol.name)
					.join(", ") || "(none)";
			const imports = file.imports.slice(0, 6).join(", ") || "(none)";
			return `- ${file.path} [${file.language}] exports: ${exports}; imports: ${imports}; ${file.summary}`;
		}),
		"</repo_map>",
	];
	return {
		query,
		content: capText(lines.join("\n"), maxTokens),
		files: scored.map((item) => item.file),
	};
}

function listIndexableFiles(root: string): string[] {
	const result: string[] = [];
	const visit = (dir: string): void => {
		if (result.length >= MAX_FILES) return;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (result.length >= MAX_FILES) return;
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (!SKIP_DIRS.has(entry.name)) visit(path);
				continue;
			}
			if (!entry.isFile()) continue;
			const ext = extname(entry.name);
			if (!INDEX_EXTENSIONS.has(ext)) continue;
			const stat = statSync(path);
			if (stat.size <= MAX_FILE_BYTES) result.push(path);
		}
	};
	visit(root);
	return result;
}

function indexFile(root: string, path: string, sha: string): RepoMapFile {
	const relativePath = relative(root, path);
	const ext = extname(path);
	const language = languageForExtension(ext);
	const text = safeRead(path);
	return {
		path: relativePath,
		language,
		imports: extractImports(text),
		exports: extractExports(text),
		summary: summarizeFile(text, relativePath),
		lastIndexedSha: sha,
	};
}

function extractImports(text: string): string[] {
	const imports = new Set<string>();
	for (const match of text.matchAll(/import\s+(?:type\s+)?(?:[^"']+\s+from\s+)?["']([^"']+)["']/g)) {
		imports.add(match[1]);
	}
	for (const match of text.matchAll(/require\(["']([^"']+)["']\)/g)) {
		imports.add(match[1]);
	}
	return [...imports].sort();
}

function extractExports(text: string): SymbolRef[] {
	const result: SymbolRef[] = [];
	const patterns: Array<{ kind: SymbolRef["kind"]; regex: RegExp }> = [
		{ kind: "function", regex: /export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g },
		{ kind: "class", regex: /export\s+class\s+([A-Za-z0-9_$]+)/g },
		{ kind: "interface", regex: /export\s+interface\s+([A-Za-z0-9_$]+)/g },
		{ kind: "type", regex: /export\s+type\s+([A-Za-z0-9_$]+)/g },
		{ kind: "const", regex: /export\s+const\s+([A-Za-z0-9_$]+)/g },
	];
	for (const pattern of patterns) {
		for (const match of text.matchAll(pattern.regex)) {
			const line = findLine(text, match.index ?? 0);
			result.push({ name: match[1], kind: pattern.kind, signature: line.trim().slice(0, 180) });
		}
	}
	for (const match of text.matchAll(/export\s+\{([^}]+)\}/g)) {
		for (const name of match[1].split(",").map((part) =>
			part
				.trim()
				.split(/\s+as\s+/i)
				.at(-1)
				?.trim(),
		)) {
			if (name) result.push({ name, kind: "export" });
		}
	}
	return dedupeSymbols(result).slice(0, 40);
}

function summarizeFile(text: string, path: string): string {
	if (path.endsWith(".md")) {
		const heading = text
			.split("\n")
			.map((line) => line.trim())
			.find((line) => line.startsWith("#"));
		return heading ? heading.replace(/^#+\s*/, "").slice(0, 160) : "Markdown document.";
	}
	const firstComment = text
		.match(/\/\*\*([\s\S]*?)\*\//)?.[1]
		?.replace(/\s+/g, " ")
		.trim();
	if (firstComment) return firstComment.slice(0, 180);
	const exports = extractExports(text)
		.slice(0, 5)
		.map((symbol) => symbol.name);
	return exports.length > 0 ? `Exports ${exports.join(", ")}.` : "No exported symbols detected.";
}

function scoreFile(file: RepoMapFile, terms: string[]): number {
	const haystack = `${file.path} ${file.language} ${file.summary} ${file.imports.join(" ")} ${file.exports
		.map((symbol) => symbol.name)
		.join(" ")}`.toLowerCase();
	let score = 0;
	for (const term of terms) {
		if (haystack.includes(term)) score++;
	}
	return score;
}

function getGitSha(root: string): string {
	const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
	return result.status === 0 ? result.stdout.trim() : "unknown";
}

function getWorktreeFingerprint(root: string): string {
	const result = spawnSync("git", ["status", "--short", "--untracked-files=all"], { cwd: root, encoding: "utf8" });
	if (result.status === 0) {
		return result.stdout.trim();
	}
	return `non-git:${listIndexableFiles(root)
		.map((path) => {
			const stat = statSync(path);
			return `${relative(root, path)}:${stat.size}:${stat.mtimeMs}`;
		})
		.join("|")}`;
}

function safeRead(path: string): string {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}

function findLine(text: string, index: number): string {
	const start = text.lastIndexOf("\n", index) + 1;
	const end = text.indexOf("\n", index);
	return text.slice(start, end === -1 ? text.length : end);
}

function dedupeSymbols(symbols: SymbolRef[]): SymbolRef[] {
	const seen = new Set<string>();
	const result: SymbolRef[] = [];
	for (const symbol of symbols) {
		const key = `${symbol.kind}:${symbol.name}`;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(symbol);
	}
	return result;
}

function languageForExtension(ext: string): string {
	switch (ext) {
		case ".ts":
		case ".tsx":
			return "typescript";
		case ".js":
		case ".jsx":
		case ".mjs":
		case ".cjs":
			return "javascript";
		case ".json":
			return "json";
		case ".md":
			return "markdown";
		default:
			return ext.replace(/^\./, "") || "text";
	}
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

function isRepoMap(value: unknown): value is RepoMap {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	return (
		record.version === REPO_MAP_VERSION &&
		typeof record.worktreeFingerprint === "string" &&
		Array.isArray(record.files)
	);
}
