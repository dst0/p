import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { renderPlanStatusMarker, type StructuredSessionState } from "./compaction/index.ts";
import type { ContextUsage } from "./extensions/types.ts";

export const PROJECT_MEMORY_ROOT = ".pdev";
export const PROJECT_MEMORY_DIR = ".pdev/memory";
export const PROJECT_STATE_DIR = ".pdev/state";
export const PROJECT_SESSIONS_DIR = ".pdev/sessions";
export const PROJECT_TRACES_DIR = ".pdev/traces";
export const PROJECT_MEMORY_STATE_FILE = ".pdev/state/session.current.json";

const SNAPSHOT_VERSION = 1;
const MAX_SEARCH_FILE_BYTES = 500_000;
const MAX_SEARCH_RESULTS = 8;

const MEMORY_FILE_TEMPLATES: ReadonlyArray<{ path: string; body: string }> = [
	{
		path: "projectbrief.md",
		body: "# Project Brief\n\nConcise durable project goal and scope. Keep this edited by humans or explicit memory commands.\n",
	},
	{
		path: "architecture.md",
		body: "# Architecture\n\nStable architecture notes, boundaries, and invariants.\n",
	},
	{
		path: "active-context.md",
		body: "# Active Context\n\nCurrent work context that should survive sessions. Keep entries short and source-backed.\n",
	},
	{
		path: "progress.md",
		body: "# Plan\n\nCurrent plan with status markers.\n",
	},
	{
		path: "decisions.md",
		body: "# Decisions\n\nDurable decisions with rationale and evidence pointers.\n",
	},
	{
		path: "commands.md",
		body: "# Commands\n\nUseful local commands, verification order, and known caveats.\n",
	},
	{
		path: "gotchas.md",
		body: "# Gotchas\n\nPinned constraints, recurring pitfalls, and recovery notes.\n",
	},
];

export interface ProjectMemorySnapshot {
	version: number;
	updatedAt: string;
	sessionId: string;
	checkpoint: string;
	state?: StructuredSessionState;
	contextUsage?: Pick<
		ContextUsage,
		"tokens" | "contextWindow" | "triggerThreshold" | "targetContextTokens" | "shouldCompact" | "toolRawTokens"
	>;
}

export interface ProjectMemoryInitResult {
	root: string;
	created: string[];
	existing: string[];
}

export interface ProjectMemoryUpdateInput {
	cwd: string;
	sessionId: string;
	checkpoint: string;
	state?: StructuredSessionState;
	contextUsage?: ContextUsage;
}

export interface ProjectMemoryUpdateResult {
	path: string;
	created: boolean;
	managedFiles: string[];
}

export interface ProjectMemoryDiffInput extends ProjectMemoryUpdateInput {}

export interface ProjectMemoryDiffResult {
	status: "missing" | "same" | "changed";
	path: string;
	lines: string[];
}

export interface ProjectMemorySearchResult {
	query: string;
	hits: Array<{
		path: string;
		line: number;
		excerpt: string;
		score: number;
	}>;
}

export interface ProjectMemoryPinResult {
	id: string;
	path: string;
}

export interface ProjectMemoryForgetResult {
	id: string;
	removed: number;
	files: string[];
}

export interface ProjectMemoryContextResult {
	query: string;
	content: string;
	hits: ProjectMemorySearchResult["hits"];
}

export function initProjectMemory(cwd: string): ProjectMemoryInitResult {
	const created: string[] = [];
	const existing: string[] = [];
	for (const dir of [PROJECT_MEMORY_DIR, PROJECT_STATE_DIR, PROJECT_SESSIONS_DIR, PROJECT_TRACES_DIR]) {
		const absoluteDir = join(cwd, dir);
		if (existsSync(absoluteDir)) {
			existing.push(dir);
		} else {
			mkdirSync(absoluteDir, { recursive: true });
			created.push(dir);
		}
	}

	for (const template of MEMORY_FILE_TEMPLATES) {
		const relativePath = join(PROJECT_MEMORY_DIR, template.path);
		const absolutePath = join(cwd, relativePath);
		if (existsSync(absolutePath)) {
			existing.push(relativePath);
			continue;
		}
		writeFileSync(absolutePath, template.body);
		created.push(relativePath);
	}

	return { root: join(cwd, PROJECT_MEMORY_ROOT), created, existing };
}

export function updateProjectMemorySnapshot(input: ProjectMemoryUpdateInput): ProjectMemoryUpdateResult {
	initProjectMemory(input.cwd);
	const path = join(input.cwd, PROJECT_MEMORY_STATE_FILE);
	const created = !existsSync(path);
	const snapshot = createSnapshot(input);
	writeFileSync(path, `${JSON.stringify(snapshot, undefined, 2)}\n`);
	const managedFiles = updateManagedMemoryFiles(input.cwd, snapshot);
	return { path, created, managedFiles };
}

export function diffProjectMemorySnapshot(input: ProjectMemoryDiffInput): ProjectMemoryDiffResult {
	const path = join(input.cwd, PROJECT_MEMORY_STATE_FILE);
	const previous = readProjectMemorySnapshot(input.cwd);
	if (!previous) {
		return {
			status: "missing",
			path,
			lines: [`No saved project memory snapshot at ${path}. Run /memory update first.`],
		};
	}

	const current = createSnapshot(input);
	const lines = compareSnapshots(previous, current);
	return {
		status: lines.length === 0 ? "same" : "changed",
		path,
		lines: lines.length === 0 ? ["Saved project memory snapshot matches current session state."] : lines,
	};
}

export function searchProjectMemory(cwd: string, query: string): ProjectMemorySearchResult {
	const terms = tokenize(query);
	if (terms.length === 0) return { query, hits: [] };
	const roots = [join(cwd, PROJECT_MEMORY_DIR), join(cwd, PROJECT_STATE_DIR)].filter((root) => existsSync(root));
	const hits: ProjectMemorySearchResult["hits"] = [];
	for (const file of roots.flatMap((root) => listMemoryFiles(root))) {
		const stat = statSync(file);
		if (!stat.isFile() || stat.size > MAX_SEARCH_FILE_BYTES) continue;
		const text = readFileSync(file, "utf8");
		const lines = text.split("\n");
		lines.forEach((line, index) => {
			const score = scoreText(line, terms);
			if (score <= 0) return;
			hits.push({
				path: relative(cwd, file),
				line: index + 1,
				excerpt: line.trim().slice(0, 240),
				score,
			});
		});
	}
	hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.line - b.line);
	return { query, hits: hits.slice(0, MAX_SEARCH_RESULTS) };
}

export function createProjectMemoryContext(
	cwd: string,
	query: string,
	maxTokens = 800,
): ProjectMemoryContextResult | undefined {
	const search = searchProjectMemory(cwd, query);
	const snapshot = readProjectMemorySnapshot(cwd);
	const terms = tokenize(query);
	const lines: string[] = [];
	const checkpointRelevant =
		snapshot?.checkpoint &&
		(search.hits.length > 0 || terms.length === 0 || scoreText(snapshot.checkpoint, terms) > 0);
	if (checkpointRelevant) {
		lines.push("Current project/session checkpoint:");
		lines.push(capText(snapshot.checkpoint, Math.min(maxTokens, 500)));
	}
	if (search.hits.length > 0) {
		lines.push("Relevant project memory snippets:");
		for (const hit of search.hits.slice(0, 5)) {
			lines.push(`- ${hit.path}:${hit.line}: ${hit.excerpt}`);
		}
	}
	if (lines.length === 0) return undefined;

	return {
		query,
		content: capText(
			[
				"<project_memory>",
				"Automatically selected durable project memory. Treat it as context, not as a replacement for current user instructions.",
				...lines,
				"</project_memory>",
			].join("\n"),
			maxTokens,
		),
		hits: search.hits,
	};
}

export function pinProjectMemory(cwd: string, text: string): ProjectMemoryPinResult {
	initProjectMemory(cwd);
	const trimmed = text.trim();
	if (!trimmed) {
		throw new Error("Usage: /memory pin <text>");
	}
	const id = `pin-${Date.now().toString(36)}`;
	const path = join(cwd, PROJECT_MEMORY_DIR, "gotchas.md");
	const line = `\n<!-- memory-id:${id} -->\n- [${id}] ${new Date().toISOString()}: ${trimmed}\n`;
	appendFileSync(path, line);
	return { id, path };
}

export function forgetProjectMemory(cwd: string, id: string): ProjectMemoryForgetResult {
	const trimmed = id.trim();
	if (!trimmed) {
		throw new Error("Usage: /memory forget <memory-id>");
	}
	const files = listMemoryFiles(join(cwd, PROJECT_MEMORY_DIR));
	let removed = 0;
	const changedFiles: string[] = [];
	for (const file of files) {
		const text = readFileSync(file, "utf8");
		const lines = text.split("\n");
		const kept = lines.filter((line) => {
			const matches = line.includes(`memory-id:${trimmed}`) || line.includes(`[${trimmed}]`);
			if (matches) removed++;
			return !matches;
		});
		if (kept.length !== lines.length) {
			writeFileSync(file, kept.join("\n"));
			changedFiles.push(relative(cwd, file));
		}
	}

	const snapshotPath = join(cwd, PROJECT_MEMORY_STATE_FILE);
	if (existsSync(snapshotPath) && trimmed === "session.current") {
		unlinkSync(snapshotPath);
		removed++;
		changedFiles.push(PROJECT_MEMORY_STATE_FILE);
	}

	return { id: trimmed, removed, files: changedFiles };
}

export function readProjectMemorySnapshot(cwd: string): ProjectMemorySnapshot | undefined {
	const path = join(cwd, PROJECT_MEMORY_STATE_FILE);
	if (!existsSync(path)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		return isProjectMemorySnapshot(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function createSnapshot(input: ProjectMemoryUpdateInput): ProjectMemorySnapshot {
	const contextUsage = input.contextUsage
		? {
				tokens: input.contextUsage.tokens,
				contextWindow: input.contextUsage.contextWindow,
				triggerThreshold: input.contextUsage.triggerThreshold,
				targetContextTokens: input.contextUsage.targetContextTokens,
				shouldCompact: input.contextUsage.shouldCompact,
				toolRawTokens: input.contextUsage.toolRawTokens ?? 0,
			}
		: undefined;
	return {
		version: SNAPSHOT_VERSION,
		updatedAt: new Date().toISOString(),
		sessionId: input.sessionId,
		checkpoint: input.checkpoint,
		state: input.state,
		contextUsage,
	};
}

function updateManagedMemoryFiles(cwd: string, snapshot: ProjectMemorySnapshot): string[] {
	const changed: string[] = [];
	const updates: Array<{ relativePath: string; body: string }> = [
		{
			relativePath: join(PROJECT_MEMORY_DIR, "active-context.md"),
			body: renderManagedBlock("auto-active-context", [
				`Updated: ${snapshot.updatedAt}`,
				`Session: ${snapshot.sessionId}`,
				`Goal: ${capLine(snapshot.state?.canonicalRequest.current || "(unknown)", 360)}`,
				"",
				"Checkpoint:",
				capText(snapshot.checkpoint, 900),
			]),
		},
		{
			relativePath: join(PROJECT_MEMORY_DIR, "progress.md"),
			body: renderManagedBlock("auto-progress", [
				`Updated: ${snapshot.updatedAt}`,
				"",
				"Plan:",
				...renderBulletList(
					snapshot.state?.plan.map((item) => `${renderPlanStatusMarker(item.status)} ${item.text}`) ?? [],
				),
			]),
		},
		{
			relativePath: join(PROJECT_MEMORY_DIR, "decisions.md"),
			body: renderManagedBlock("auto-decisions", [
				`Updated: ${snapshot.updatedAt}`,
				"",
				...renderBulletList(
					(snapshot.state?.decisions ?? [])
						.filter((decision) => decision.status === "active")
						.map((decision) => `${decision.decision}${decision.rationale ? ` - ${decision.rationale}` : ""}`),
				),
			]),
		},
		{
			relativePath: join(PROJECT_MEMORY_DIR, "commands.md"),
			body: renderManagedBlock("auto-context-budget", [
				`Updated: ${snapshot.updatedAt}`,
				`Context tokens: ${snapshot.contextUsage?.tokens ?? "(unknown)"}/${snapshot.contextUsage?.contextWindow ?? "(unknown)"}`,
				`Trigger threshold: ${snapshot.contextUsage?.triggerThreshold ?? "(unknown)"}`,
			]),
		},
	];

	for (const update of updates) {
		const path = join(cwd, update.relativePath);
		const before = existsSync(path) ? readFileSync(path, "utf8") : "";
		const after = replaceManagedBlock(before, update.body);
		if (before !== after) {
			writeFileSync(path, after);
			changed.push(update.relativePath);
		}
	}

	return changed;
}

function renderManagedBlock(id: string, lines: string[]): string {
	return [`<!-- p:${id}:begin -->`, ...lines, `<!-- p:${id}:end -->`].join("\n");
}

function replaceManagedBlock(content: string, block: string): string {
	const firstLine = block.slice(0, block.indexOf("\n"));
	const lastLine = block.slice(block.lastIndexOf("\n") + 1);
	const start = content.indexOf(firstLine);
	const end = content.indexOf(lastLine);
	if (start !== -1 && end !== -1 && end >= start) {
		return `${content.slice(0, start)}${block}${content.slice(end + lastLine.length)}`;
	}
	const separator = content.trim().length > 0 ? "\n\n" : "";
	return `${content.trimEnd()}${separator}${block}\n`;
}

function renderBulletList(items: string[]): string[] {
	return items.length > 0 ? items.map((item) => `- ${item}`) : ["- (none)"];
}

function compareSnapshots(previous: ProjectMemorySnapshot, current: ProjectMemorySnapshot): string[] {
	const lines: string[] = [];
	pushDiff(lines, "session", previous.sessionId, current.sessionId);
	pushDiff(lines, "goal", previous.state?.canonicalRequest.current, current.state?.canonicalRequest.current);
	pushDiff(lines, "checkpoint", previous.checkpoint, current.checkpoint);
	pushDiff(lines, "context tokens", previous.contextUsage?.tokens, current.contextUsage?.tokens);
	pushDiff(lines, "active constraints", countActiveConstraints(previous.state), countActiveConstraints(current.state));
	pushDiff(lines, "plan signature", planSignature(previous.state), planSignature(current.state));
	pushDiff(lines, "touched files", fileSignature(previous.state), fileSignature(current.state));
	pushDiff(lines, "evidence pointers", previous.state?.evidence.length, current.state?.evidence.length);
	return lines;
}

function pushDiff(lines: string[], label: string, before: unknown, after: unknown): void {
	if (JSON.stringify(before) === JSON.stringify(after)) return;
	lines.push(`${label}: ${formatDiffValue(before)} -> ${formatDiffValue(after)}`);
}

function countActiveConstraints(state: StructuredSessionState | undefined): number {
	return state?.constraints.filter((constraint) => constraint.status === "active").length ?? 0;
}

function planSignature(state: StructuredSessionState | undefined): string {
	return state?.plan.map((item) => `${item.id}:${item.status}`).join(",") ?? "";
}

function fileSignature(state: StructuredSessionState | undefined): string {
	return state?.codebase.touchedFiles.map((file) => `${file.path}:${file.status}`).join(",") ?? "";
}

function formatDiffValue(value: unknown): string {
	if (typeof value === "string") {
		return value.length > 120 ? `${value.slice(0, 117)}...` : value || "(empty)";
	}
	if (value === undefined) return "(missing)";
	return JSON.stringify(value);
}

function listMemoryFiles(root: string): string[] {
	if (!existsSync(root)) return [];
	const result: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) {
			result.push(...listMemoryFiles(path));
		} else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".json"))) {
			result.push(path);
		}
	}
	return result;
}

function tokenize(query: string): string[] {
	return query
		.toLowerCase()
		.split(/[^a-z0-9_.:/-]+/i)
		.map((term) => term.trim())
		.filter((term) => term.length > 0);
}

function scoreText(text: string, terms: string[]): number {
	const lower = text.toLowerCase();
	let score = 0;
	for (const term of terms) {
		if (lower.includes(term)) score++;
	}
	return score / terms.length;
}

function capText(text: string, maxTokens: number): string {
	const maxChars = Math.max(200, maxTokens * 4);
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars - 14).trimEnd()}\n[truncated]`;
}

function capLine(text: string, maxChars: number): string {
	const compacted = text.replace(/\s+/g, " ").trim();
	if (compacted.length <= maxChars) return compacted;
	const prefix = compacted.slice(0, Math.max(20, maxChars - 1));
	const wordBreak = prefix.lastIndexOf(" ");
	const cutAt = wordBreak > Math.floor(maxChars * 0.4) ? wordBreak : prefix.length;
	return `${prefix.slice(0, cutAt).trimEnd()}...`;
}

function isProjectMemorySnapshot(value: unknown): value is ProjectMemorySnapshot {
	if (!isRecord(value)) return false;
	return (
		value.version === SNAPSHOT_VERSION && typeof value.updatedAt === "string" && typeof value.sessionId === "string"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
