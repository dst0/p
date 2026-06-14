import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

const SUBAGENT_DIGESTS_FILE = ".pdev/sessions/subagent-digests.jsonl";
const SUBAGENT_TRANSCRIPTS_DIR = ".pdev/sessions/subagents";

export type SubagentName = "explore" | "scout" | "review" | "compact";
export type SubagentMode = "subagent" | "system";
export type SubagentPermission = "allow" | "deny" | "ask";

/** Mapping from permission key to base tool names allowed by that permission */
const PERMISSION_TO_TOOL: Record<string, string[]> = {
	read: ["read"],
	grep: ["grep"],
	list: ["ls", "find"],
	edit: ["edit", "write"],
	bash: ["bash"],
	web: [],
	diff: [],
	test: [],
};

/** Maximum number of turns for a subagent run */
export const SUBAGENT_MAX_TURNS = 8;

export interface SubagentProfile {
	name: SubagentName;
	mode: SubagentMode;
	hidden?: boolean;
	description: string;
	permissions: {
		read?: SubagentPermission;
		grep?: SubagentPermission;
		list?: SubagentPermission;
		edit?: SubagentPermission;
		bash?: SubagentPermission;
		web?: SubagentPermission;
		diff?: SubagentPermission;
		test?: SubagentPermission;
	};
}

export interface SubagentDigest {
	id: string;
	profile: SubagentName;
	query: string;
	summary: string;
	evidencePointers: string[];
	transcriptPath?: string;
	createdAt: string;
}

export const BUILTIN_SUBAGENT_PROFILES: readonly SubagentProfile[] = [
	{
		name: "explore",
		mode: "subagent",
		description: "Read-only codebase exploration. Parent context receives only a digest.",
		permissions: { read: "allow", grep: "allow", list: "allow", edit: "deny", bash: "deny" },
	},
	{
		name: "scout",
		mode: "subagent",
		description: "Read-only external or dependency research. Parent context receives only a digest.",
		permissions: { web: "allow", read: "allow", edit: "deny", bash: "deny" },
	},
	{
		name: "review",
		mode: "subagent",
		description: "Read-only diff and test-risk review. Parent context receives only findings.",
		permissions: { diff: "allow", test: "ask", read: "allow", edit: "deny" },
	},
	{
		name: "compact",
		mode: "system",
		hidden: true,
		description: "Hidden compaction worker. Produces structured state and audit output only.",
		permissions: { read: "allow", edit: "deny", bash: "deny" },
	},
];

export function createSubagentProfilesPrompt(): string {
	return [
		"<subagent_profiles>",
		"Use subagents for noisy exploration. Do not paste raw subagent transcripts into parent context; store and cite digests.",
		...BUILTIN_SUBAGENT_PROFILES.filter((profile) => !profile.hidden).map(
			(profile) => `- ${profile.name}: ${profile.description} permissions=${JSON.stringify(profile.permissions)}`,
		),
		"</subagent_profiles>",
	].join("\n");
}

export function persistSubagentDigest(cwd: string, digest: Omit<SubagentDigest, "id" | "createdAt">): SubagentDigest {
	const full: SubagentDigest = {
		...digest,
		id: `subagent:${digest.profile}:${Date.now().toString(36)}`,
		createdAt: new Date().toISOString(),
	};
	const path = join(cwd, SUBAGENT_DIGESTS_FILE);
	mkdirSync(dirname(path), { recursive: true });
	appendFileSync(path, `${JSON.stringify(full)}\n`);
	return full;
}

export function readSubagentDigests(cwd: string): SubagentDigest[] {
	const path = join(cwd, SUBAGENT_DIGESTS_FILE);
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.flatMap((line) => {
			try {
				const parsed = JSON.parse(line) as unknown;
				return isSubagentDigest(parsed) ? [parsed] : [];
			} catch {
				return [];
			}
		});
}

export function persistSubagentTranscript(cwd: string, id: string, messages: AgentMessage[]): string {
	const safeId = id.replace(/[^A-Za-z0-9_.:-]+/g, "_");
	const relativePath = join(SUBAGENT_TRANSCRIPTS_DIR, `${safeId}.jsonl`);
	const path = join(cwd, relativePath);
	mkdirSync(dirname(path), { recursive: true });
	const body = messages.map((message) => JSON.stringify({ type: "message", message })).join("\n");
	appendFileSync(path, body.length > 0 ? `${body}\n` : "");
	return relativePath;
}

export function createSubagentDigestContext(cwd: string, query: string): string | undefined {
	const terms = tokenize(query);
	if (terms.length === 0) return undefined;
	const digests = readSubagentDigests(cwd)
		.map((digest) => ({ digest, score: scoreDigest(digest, terms) }))
		.filter((item) => item.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, 5);
	if (digests.length === 0) return undefined;
	return [
		"<subagent_digests>",
		...digests.map(
			({ digest }) =>
				`- ${digest.id} [${digest.profile}] ${digest.summary} evidence=${digest.evidencePointers.join(",") || "(none)"}`,
		),
		"</subagent_digests>",
	].join("\n");
}

function scoreDigest(digest: SubagentDigest, terms: string[]): number {
	const text =
		`${digest.profile} ${digest.query} ${digest.summary} ${digest.evidencePointers.join(" ")}`.toLowerCase();
	let score = 0;
	for (const term of terms) {
		if (text.includes(term)) score++;
	}
	return score;
}

function tokenize(value: string): string[] {
	return value
		.toLowerCase()
		.split(/[^a-z0-9_.:/-]+/i)
		.map((term) => term.trim())
		.filter((term) => term.length > 0);
}

/** Get the set of allowed tool names for a subagent profile */
export function getSubagentAllowedTools(profile: SubagentName): Set<string> {
	const subagentProfile = BUILTIN_SUBAGENT_PROFILES.find((p) => p.name === profile);
	if (!subagentProfile) return new Set();

	const allowed = new Set<string>();
	for (const [perm, tools] of Object.entries(subagentProfile.permissions)) {
		if (perm === "web" || perm === "diff" || perm === "test") continue; // no base tool mapping
		if (tools === undefined) continue;
		if (
			perm in subagentProfile.permissions &&
			subagentProfile.permissions[perm as keyof typeof subagentProfile.permissions] === "allow"
		) {
			for (const tool of PERMISSION_TO_TOOL[perm] ?? []) {
				allowed.add(tool);
			}
		}
	}
	allowed.add("session_recall");
	return allowed;
}

/** Subagent input parameters */
export interface RunSubagentInput {
	/** Profile name: explore, scout, review */
	profile: SubagentName;
	/** Task description for the subagent */
	task: string;
}

export interface RunSubagentResult {
	id: string;
	profile: SubagentName;
	task: string;
	summary: string;
	evidencePointers: string[];
	turnCount: number;
}

function isSubagentDigest(value: unknown): value is SubagentDigest {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.id === "string" &&
		typeof record.profile === "string" &&
		typeof record.query === "string" &&
		typeof record.summary === "string" &&
		Array.isArray(record.evidencePointers)
	);
}
