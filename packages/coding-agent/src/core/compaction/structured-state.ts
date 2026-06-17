import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionEntry } from "../session-manager.ts";
import type { CompactionAudit, EvidencePointer } from "./compaction.ts";

export const STRUCTURED_SESSION_STATE_CUSTOM_TYPE = "pi.structured-session-state";
export const STRUCTURED_SESSION_STATE_VERSION = 1;
const MAX_CANONICAL_REQUEST_CHARS = 480;
const MAX_REQUEST_SUMMARY_CHARS = 280;

export type ConstraintSource = "user" | "system" | "project" | "inferred";
export type ConstraintStatus = "active" | "superseded" | "rejected";
export type ConstraintEnforceability = "prompt" | "runtime_check" | "test" | "manual";
export type PlanStatus = "not_started" | "in_progress" | "done" | "failed" | "blocked";
export type FileTouchStatus = "read" | "modified" | "created" | "deleted";

export interface Constraint {
	id: string;
	text: string;
	source: ConstraintSource;
	status: ConstraintStatus;
	enforceability: ConstraintEnforceability;
}

export interface PlanItem {
	id: string;
	text: string;
	status: PlanStatus;
	evidenceEntryIds: string[];
}

export interface Decision {
	id: string;
	decision: string;
	rationale: string;
	evidencePointers: EvidencePointer[];
	status: "active" | "superseded";
}

export interface TouchedFile {
	path: string;
	status: FileTouchStatus;
	summary: string;
}

export interface RelevantSymbol {
	name: string;
	file: string;
	reason: string;
}

export interface OriginalUserRequest {
	id: string;
	entryId: string;
	timestamp: string;
	kind: "request" | "correction" | "follow_up";
	text: string;
	summary: string;
}

export interface StructuredSessionState {
	version: number;
	sessionId: string;
	canonicalRequest: {
		current: string;
		sourceEntryIds: string[];
		originalRequests: OriginalUserRequest[];
		superseded: Array<{
			old: string;
			replacedBy: string;
			reason: string;
			entryId: string;
		}>;
	};
	constraints: Constraint[];
	plan: PlanItem[];
	progress: {
		done: string[];
		current: string[];
		next: string[];
		blocked: string[];
	};
	decisions: Decision[];
	codebase: {
		touchedFiles: TouchedFile[];
		relevantSymbols: RelevantSymbol[];
	};
	evidence: EvidencePointer[];
	audit: {
		lastCompactionAt: string;
		compactionCount: number;
		knownRisks: string[];
	};
}

export interface StatePatch {
	canonicalRequest?: Partial<StructuredSessionState["canonicalRequest"]>;
	constraints?: {
		add?: Constraint[];
		update?: Array<{ id: string; patch: Partial<Constraint> }>;
	};
	plan?: {
		add?: PlanItem[];
		update?: Array<{ id: string; status?: PlanStatus; text?: string; evidenceEntryIds?: string[] }>;
	};
	progress?: Partial<StructuredSessionState["progress"]>;
	decisions?: {
		add?: Decision[];
		supersede?: Array<{ id: string; reason: string }>;
	};
	codebase?: Partial<StructuredSessionState["codebase"]>;
	evidence?: {
		add?: EvidencePointer[];
	};
	audit?: Partial<StructuredSessionState["audit"]>;
}

export interface StructuredStateUpdateInput {
	sessionId: string;
	previous?: StructuredSessionState;
	summary: string;
	entries: SessionEntry[];
	readFiles?: string[];
	modifiedFiles?: string[];
	audit?: CompactionAudit;
	timestamp?: string;
}

export interface LiveStructuredStateInput {
	sessionId: string;
	previous?: StructuredSessionState;
	entries: SessionEntry[];
	timestamp?: string;
}

export function createInitialStructuredSessionState(sessionId: string): StructuredSessionState {
	return {
		version: STRUCTURED_SESSION_STATE_VERSION,
		sessionId,
		canonicalRequest: {
			current: "",
			sourceEntryIds: [],
			originalRequests: [],
			superseded: [],
		},
		constraints: [],
		plan: [],
		progress: {
			done: [],
			current: [],
			next: [],
			blocked: [],
		},
		decisions: [],
		codebase: {
			touchedFiles: [],
			relevantSymbols: [],
		},
		evidence: [],
		audit: {
			lastCompactionAt: "",
			compactionCount: 0,
			knownRisks: [],
		},
	};
}

export function isStructuredSessionState(value: unknown): value is StructuredSessionState {
	if (!isRecord(value)) return false;
	return (
		value.version === STRUCTURED_SESSION_STATE_VERSION &&
		typeof value.sessionId === "string" &&
		isRecord(value.canonicalRequest) &&
		Array.isArray(value.constraints) &&
		Array.isArray(value.plan) &&
		isRecord(value.progress) &&
		Array.isArray(value.decisions) &&
		isRecord(value.codebase) &&
		Array.isArray(value.evidence) &&
		isRecord(value.audit)
	);
}

export function getLatestStructuredSessionState(entries: SessionEntry[]): StructuredSessionState | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry.type !== "custom" || entry.customType !== STRUCTURED_SESSION_STATE_CUSTOM_TYPE) continue;
		if (isStructuredSessionState(entry.data)) {
			return entry.data;
		}
	}
	return undefined;
}

export function createStructuredSessionState(input: StructuredStateUpdateInput): StructuredSessionState {
	const previous = input.previous ?? createInitialStructuredSessionState(input.sessionId);
	const patch = createStatePatchFromSummary(input);
	return mergeStructuredSessionState(previous, patch);
}

export function createLiveStructuredSessionState(input: LiveStructuredStateInput): StructuredSessionState {
	const previous = input.previous ?? createInitialStructuredSessionState(input.sessionId);
	const patch = createStatePatchFromLiveSession(input);
	return mergeStructuredSessionState(previous, patch);
}

export function mergeStructuredSessionState(
	previous: StructuredSessionState,
	patch: StatePatch,
): StructuredSessionState {
	const next: StructuredSessionState = {
		...previous,
		canonicalRequest: {
			current: previous.canonicalRequest.current,
			sourceEntryIds: [...previous.canonicalRequest.sourceEntryIds],
			originalRequests: (previous.canonicalRequest.originalRequests ?? []).map((request) => ({ ...request })),
			superseded: previous.canonicalRequest.superseded.map((item) => ({ ...item })),
		},
		constraints: previous.constraints.map((constraint) => ({ ...constraint })),
		plan: previous.plan.map((item) => ({ ...item, evidenceEntryIds: [...item.evidenceEntryIds] })),
		progress: {
			done: [...previous.progress.done],
			current: [...previous.progress.current],
			next: [...previous.progress.next],
			blocked: [...previous.progress.blocked],
		},
		decisions: previous.decisions.map((decision) => ({
			...decision,
			evidencePointers: decision.evidencePointers.map((pointer) => ({ ...pointer })),
		})),
		codebase: {
			touchedFiles: previous.codebase.touchedFiles.map((file) => ({ ...file })),
			relevantSymbols: previous.codebase.relevantSymbols.map((symbol) => ({ ...symbol })),
		},
		evidence: previous.evidence.map((pointer) => ({ ...pointer })),
		audit: {
			lastCompactionAt: previous.audit.lastCompactionAt,
			compactionCount: previous.audit.compactionCount,
			knownRisks: [...previous.audit.knownRisks],
		},
	};

	if (patch.canonicalRequest) {
		mergeCanonicalRequest(next, patch.canonicalRequest);
	}
	if (patch.constraints) {
		mergeConstraints(next, patch.constraints);
	}
	if (patch.plan) {
		mergePlan(next, patch.plan);
	}
	if (patch.progress) {
		next.progress = {
			done: mergeStringList(next.progress.done, patch.progress.done),
			current: mergeStringList([], patch.progress.current ?? next.progress.current),
			next: mergeStringList([], patch.progress.next ?? next.progress.next),
			blocked: mergeStringList(next.progress.blocked, patch.progress.blocked),
		};
	}
	if (patch.decisions) {
		mergeDecisions(next, patch.decisions);
	}
	if (patch.codebase) {
		next.codebase = {
			touchedFiles: mergeTouchedFiles(next.codebase.touchedFiles, patch.codebase.touchedFiles ?? []),
			relevantSymbols: mergeRelevantSymbols(next.codebase.relevantSymbols, patch.codebase.relevantSymbols ?? []),
		};
	}
	if (patch.evidence?.add) {
		next.evidence = mergeEvidence(next.evidence, patch.evidence.add);
	}
	if (patch.audit) {
		next.audit = {
			lastCompactionAt: patch.audit.lastCompactionAt ?? next.audit.lastCompactionAt,
			compactionCount: patch.audit.compactionCount ?? next.audit.compactionCount,
			knownRisks: mergeStringList(next.audit.knownRisks, patch.audit.knownRisks),
		};
	}

	return next;
}

export function renderStructuredSessionCheckpoint(state: StructuredSessionState, maxTokens: number): string {
	const activeConstraints = state.constraints
		.filter((constraint) => constraint.status === "active")
		.map((constraint) => capPromptLine(constraint.text, 240));
	const plan = state.plan
		.slice(0, 12)
		.map((item) => `- [${renderPlanStatus(item.status)}] ${capPromptLine(item.text, 220)}`);
	const nextAction = (state.progress.next.length > 0 ? state.progress.next : state.progress.current.slice(0, 3)).map(
		(item) => capPromptLine(item, 220),
	);
	const touchedFiles = state.codebase.touchedFiles
		.slice(0, 20)
		.map((file) => `${file.status}: ${file.path} - ${capPromptLine(file.summary, 180)}`);
	const evidence = state.evidence
		.slice(0, 20)
		.map((pointer) => `${pointer.id}: ${capPromptLine(pointer.summary, 180)}`);
	const knownRisks = state.audit.knownRisks.map((risk) => capPromptLine(risk, 220));
	const lines = [
		"<session_checkpoint>",
		`Goal: ${capPromptLine(normalizeCanonicalRequest(state.canonicalRequest.current), 520) || "(no user request recorded yet)"}`,
		`Original requests stored: ${state.canonicalRequest.originalRequests?.length ?? 0}`,
		"Active constraints:",
		...renderList(activeConstraints),
		"Current plan:",
		...(plan.length > 0 ? plan : ["- (none)"]),
		"Next action:",
		...renderList(nextAction),
		"Touched files:",
		...renderList(touchedFiles),
		"Retrieve if needed:",
		...renderList(evidence),
		"Known risks:",
		...renderList(knownRisks),
		"</session_checkpoint>",
	];
	return capCheckpoint(lines.join("\n"), maxTokens);
}

function createStatePatchFromSummary(input: StructuredStateUpdateInput): StatePatch {
	const timestamp = input.timestamp ?? new Date().toISOString();
	const sourceEntryIds = input.entries.map((entry) => entry.id).filter((id) => id.length > 0);
	const summaryGoal = extractSection(input.summary, "Goal").trim();
	const originalRequests = collectOriginalUserRequests(input.entries);
	const latestCorrection = [...originalRequests].reverse().find((request) => request.kind === "correction");
	const latestRequest = [...originalRequests].reverse().find((request) => request.kind !== "correction");
	const normalizedSummaryGoal = normalizeCanonicalRequest(summaryGoal);
	const goal =
		normalizeCanonicalRequest(latestCorrection?.summary ?? "") ||
		(isPlaceholderGoal(normalizedSummaryGoal) ? "" : normalizedSummaryGoal) ||
		normalizeCanonicalRequest(input.previous?.canonicalRequest.current ?? "") ||
		normalizeCanonicalRequest(latestRequest?.summary ?? "") ||
		createPlainSummaryFallback(input.summary);
	const planItems = extractPlanItems(input.summary, sourceEntryIds);
	const progress = extractProgress(input.summary);
	const decisions = extractDecisions(input.summary);
	const evidence = createEvidencePointers(input);
	const touchedFiles = [
		...(input.readFiles ?? []).map(
			(path): TouchedFile => ({
				path,
				status: "read",
				summary: "Read during compacted session history.",
			}),
		),
		...(input.modifiedFiles ?? []).map(
			(path): TouchedFile => ({
				path,
				status: "modified",
				summary: "Modified during compacted session history.",
			}),
		),
	];

	return {
		canonicalRequest: goal
			? {
					current: goal,
					sourceEntryIds: mergeStringList(
						sourceEntryIds,
						originalRequests.map((request) => request.entryId),
					),
					originalRequests,
				}
			: undefined,
		plan: planItems.length > 0 ? { add: planItems } : undefined,
		progress,
		decisions: decisions.length > 0 ? { add: decisions } : undefined,
		codebase: touchedFiles.length > 0 ? { touchedFiles, relevantSymbols: [] } : undefined,
		evidence: evidence.length > 0 ? { add: evidence } : undefined,
		audit: {
			lastCompactionAt: timestamp,
			compactionCount: (input.previous?.audit.compactionCount ?? 0) + 1,
			knownRisks: input.audit?.risks ?? [],
		},
	};
}

function createStatePatchFromLiveSession(input: LiveStructuredStateInput): StatePatch {
	const sourceEntryIds = input.entries.map((entry) => entry.id).filter((id) => id.length > 0);
	const originalRequests = collectOriginalUserRequests(input.entries);
	const latestCorrection = [...originalRequests].reverse().find((request) => request.kind === "correction");
	const latestRequest = [...originalRequests].reverse().find((request) => request.kind !== "correction");
	const goal =
		normalizeCanonicalRequest(latestCorrection?.summary ?? "") ||
		normalizeCanonicalRequest(input.previous?.canonicalRequest.current ?? "") ||
		normalizeCanonicalRequest(latestRequest?.summary ?? "");
	const liveMarkdown = createLiveConversationMarkdown(input.entries);
	const planItems = extractPlanItems(liveMarkdown, sourceEntryIds);
	const progress = withLiveProgressFallbacks(extractProgress(liveMarkdown), planItems);
	const decisions = extractDecisions(liveMarkdown);
	const evidence = createEvidencePointers({
		sessionId: input.sessionId,
		entries: input.entries,
		summary: liveMarkdown,
	});

	return {
		canonicalRequest: goal
			? {
					current: goal,
					sourceEntryIds: mergeStringList(
						sourceEntryIds,
						originalRequests.map((request) => request.entryId),
					),
					originalRequests,
				}
			: originalRequests.length > 0
				? { sourceEntryIds, originalRequests }
				: undefined,
		plan: planItems.length > 0 ? { add: planItems } : undefined,
		progress,
		decisions: decisions.length > 0 ? { add: decisions } : undefined,
		evidence: evidence.length > 0 ? { add: evidence } : undefined,
	};
}

function extractSection(markdown: string, heading: string): string {
	return extractOptionalSection(markdown, heading) ?? "";
}

function extractOptionalSection(markdown: string, heading: string): string | undefined {
	const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = markdown.match(new RegExp(`^##\\s+${escapedHeading}\\s*$([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`, "m"));
	return match?.[1]?.trim();
}

function createPlainSummaryFallback(summary: string): string {
	return normalizeCanonicalRequest(
		summary
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0)
			.slice(0, 6)
			.join(" "),
	);
}

function isPlaceholderGoal(goal: string): boolean {
	if (!goal) return true;
	return (
		/^(awaiting|waiting for) (initial )?user (prompt|input|request)\b/i.test(goal) ||
		/^no conversation provided\b/i.test(goal)
	);
}

function collectOriginalUserRequests(entries: SessionEntry[]): OriginalUserRequest[] {
	const requests: OriginalUserRequest[] = [];
	for (const entry of entries) {
		if (entry.type !== "message" || entry.message.role !== "user") continue;
		const text = getAgentMessageText(entry.message).trim();
		if (!text) continue;
		const kind = classifyUserRequest(text, requests.length);
		requests.push({
			id: `request:${entry.id || createStableId("user", `${requests.length}:${text}`)}`,
			entryId: entry.id,
			timestamp: entry.timestamp,
			kind,
			text,
			summary: summarizeUserRequest(text),
		});
	}
	return requests;
}

function classifyUserRequest(text: string, userIndex: number): OriginalUserRequest["kind"] {
	if (isExplicitGoalCorrection(text)) return "correction";
	return userIndex === 0 ? "request" : "follow_up";
}

function summarizeUserRequest(text: string): string {
	const cleaned = stripCorrectionPrefix(text)
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("```"))
		.slice(0, 4)
		.join(" ");
	return capSentence(compactWhitespace(cleaned || text), MAX_REQUEST_SUMMARY_CHARS);
}

function normalizeCanonicalRequest(text: string): string {
	const trimmed = text.trim();
	if (!trimmed) return "";
	const withoutPrefix = stripCorrectionPrefix(trimmed);
	const paragraphs = withoutPrefix
		.split(/\n\s*\n/)
		.map((paragraph) => compactWhitespace(paragraph.replace(/^#+\s*/, "")))
		.filter((paragraph) => paragraph.length > 0 && !paragraph.startsWith("```"));
	const candidate = paragraphs[0] ?? compactWhitespace(withoutPrefix);
	return capSentence(candidate, MAX_CANONICAL_REQUEST_CHARS);
}

function stripCorrectionPrefix(text: string): string {
	return text
		.replace(/^(correction|actually|instead|new goal|updated request)\s*[:,-]?\s*/i, "")
		.replace(/^change (the )?goal\s*[:,-]?\s*/i, "")
		.replace(/^do this instead\s*[:,-]?\s*/i, "")
		.trim();
}

function compactWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function capSentence(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	const hardLimit = Math.max(20, maxChars - 1);
	const prefix = text.slice(0, hardLimit);
	const sentenceBreak = Math.max(prefix.lastIndexOf(". "), prefix.lastIndexOf("! "), prefix.lastIndexOf("? "));
	const wordBreak = prefix.lastIndexOf(" ");
	const cutAt =
		sentenceBreak > Math.floor(maxChars * 0.35) ? sentenceBreak + 1 : wordBreak > 0 ? wordBreak : hardLimit;
	return `${prefix.slice(0, cutAt).trimEnd()}...`;
}

function isExplicitGoalCorrection(text: string): boolean {
	return /\b(correction|actually|instead|new goal|change the goal|change goal|updated request|do this instead)\b/i.test(
		text,
	);
}

function getAgentMessageText(message: AgentMessage): string {
	if (message.role === "user" || message.role === "custom") {
		return typeof message.content === "string"
			? message.content
			: message.content
					.filter((block) => block.type === "text")
					.map((block) => block.text)
					.join("\n");
	}
	if (message.role === "assistant" || message.role === "toolResult") {
		return message.content
			.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join("\n");
	}
	if (message.role === "bashExecution") {
		return `${message.command}\n${message.output}`;
	}
	return message.summary;
}

function extractOptionalSubsection(markdown: string, section: string, subsection: string): string | undefined {
	const sectionText = extractSection(markdown, section);
	const escapedSubsection = subsection.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = sectionText.match(
		new RegExp(`^###\\s+${escapedSubsection}\\s*$([\\s\\S]*?)(?=^###\\s+|(?![\\s\\S]))`, "m"),
	);
	return match?.[1]?.trim();
}

function extractPlanItems(markdown: string, sourceEntryIds: string[]): PlanItem[] {
	const section = [
		extractOptionalSection(markdown, "Plan & Progress"),
		extractOptionalSection(markdown, "Plan"),
		extractOptionalSection(markdown, "Current Plan"),
		...extractLooseSections(markdown, ["Plan & Progress", "Plan", "Current Plan"]),
	]
		.filter((value): value is string => value !== undefined && value.trim().length > 0)
		.join("\n");
	const items: PlanItem[] = [];
	const seen = new Set<string>();
	for (const rawLine of section.split("\n")) {
		const line = rawLine.trim();
		const checkboxMatch = line.match(/^-\s+\[([ .vx-])\]\s+(.+)$/i);
		const numberedMatch = line.match(/^\d+[.)]\s+(.+)$/);
		const bulletMatch = line.match(/^-\s+(.+)$/);
		const text = (checkboxMatch?.[2] ?? numberedMatch?.[1] ?? bulletMatch?.[1] ?? "").trim();
		if (!text) continue;
		if (text === "(none)") continue;
		const id = createStableId("plan", text);
		if (seen.has(id)) continue;
		seen.add(id);
		items.push({
			id,
			text,
			status: checkboxMatch ? parsePlanStatus(checkboxMatch[1]) : "not_started",
			evidenceEntryIds: [...sourceEntryIds],
		});
	}
	return items;
}

function extractProgress(markdown: string): StatePatch["progress"] {
	const done = extractOptionalBulletLines(findProgressBlock(markdown, "Done", ["Done", "Completed"]));
	const current = extractOptionalBulletLines(findProgressBlock(markdown, "In Progress", ["In Progress", "Current"]));
	const blocked = extractOptionalBulletLines(findProgressBlock(markdown, "Blocked", ["Blocked", "Blockers"]));
	const next = extractOptionalNumberedLines(
		extractOptionalSection(markdown, "Next Steps") ??
			extractOptionalSection(markdown, "Next Actions") ??
			joinLooseSections(markdown, ["Next Steps", "Next Actions", "Remaining Work"]),
	);
	const progress: NonNullable<StatePatch["progress"]> = {};
	if (done !== undefined) progress.done = done;
	if (current !== undefined) progress.current = current;
	if (blocked !== undefined) progress.blocked = blocked;
	if (next !== undefined) progress.next = next;
	return Object.keys(progress).length > 0 ? progress : undefined;
}

function createLiveConversationMarkdown(entries: SessionEntry[]): string {
	const messages: string[] = [];
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		if (entry.message.role !== "assistant" && entry.message.role !== "custom") continue;
		const text = getAgentMessageText(entry.message).trim();
		if (text) {
			messages.push(text);
		}
	}
	return messages.slice(-12).join("\n\n");
}

function withLiveProgressFallbacks(progress: StatePatch["progress"], planItems: PlanItem[]): StatePatch["progress"] {
	const nextPlanItems = planItems
		.filter((item) => item.status === "not_started" || item.status === "in_progress")
		.slice(0, 3)
		.map((item) => item.text);
	if (nextPlanItems.length === 0) {
		return progress;
	}
	return {
		...progress,
		next: progress?.next !== undefined ? progress.next : nextPlanItems,
	};
}

function findProgressBlock(markdown: string, subsection: string, looseHeadings: string[]): string | undefined {
	return extractOptionalSubsection(markdown, "Progress", subsection) ?? joinLooseSections(markdown, looseHeadings);
}

function joinLooseSections(markdown: string, headings: string[]): string | undefined {
	const loose = extractLooseSections(markdown, headings).join("\n").trim();
	return loose.length > 0 ? loose : undefined;
}

function extractLooseSections(markdown: string, headings: string[]): string[] {
	const wanted = new Set(headings.map(normalizeHeadingLabel));
	const sections: string[] = [];
	const current: string[] = [];
	let collecting = false;

	for (const rawLine of markdown.split("\n")) {
		const heading = parseLooseHeading(rawLine);
		if (heading) {
			if (collecting && current.length > 0) {
				sections.push(current.join("\n").trim());
			}
			current.length = 0;
			collecting = wanted.has(normalizeHeadingLabel(heading));
			continue;
		}
		if (collecting) {
			current.push(rawLine);
		}
	}

	if (collecting && current.length > 0) {
		sections.push(current.join("\n").trim());
	}

	return sections.filter((section) => section.length > 0);
}

function parseLooseHeading(line: string): string | undefined {
	const trimmed = line.trim();
	if (!trimmed) return undefined;
	const markdownMatch = trimmed.match(/^#{1,6}\s+(.+?)\s*$/);
	if (markdownMatch) return cleanupHeadingLabel(markdownMatch[1]);
	const boldMatch = trimmed.match(/^\*\*(.+?)\*\*:?\s*$/);
	if (boldMatch) return cleanupHeadingLabel(boldMatch[1]);
	const colonMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9 &/_-]{1,80}):\s*$/);
	if (colonMatch) return cleanupHeadingLabel(colonMatch[1]);
	return undefined;
}

function cleanupHeadingLabel(label: string): string {
	return label.replace(/[*:]+$/g, "").trim();
}

function normalizeHeadingLabel(label: string): string {
	return cleanupHeadingLabel(label).toLowerCase().replace(/\s+/g, " ");
}

function extractDecisions(markdown: string): Decision[] {
	const decisionText = [
		extractOptionalSection(markdown, "Key Decisions"),
		extractOptionalSection(markdown, "Decisions"),
		...extractLooseSections(markdown, ["Key Decisions", "Decisions"]),
	]
		.filter((value): value is string => value !== undefined && value.trim().length > 0)
		.join("\n");
	const seen = new Set<string>();
	const decisions: Decision[] = [];
	for (const line of extractBulletLines(decisionText)) {
		const normalized = line.replace(/^\*\*(.*?)\*\*:\s*/, "$1: ");
		const [decision, ...rationaleParts] = normalized.split(": ");
		const rationale = rationaleParts.join(": ").trim();
		const id = createStableId("decision", normalized);
		if (seen.has(id)) continue;
		seen.add(id);
		decisions.push({
			id,
			decision: decision.trim() || normalized,
			rationale,
			evidencePointers: [],
			status: "active",
		});
	}
	return decisions;
}

function createEvidencePointers(input: StructuredStateUpdateInput): EvidencePointer[] {
	const pointers: EvidencePointer[] = [];
	for (const entry of input.entries) {
		if (entry.type === "message" && entry.message.role === "toolResult") {
			pointers.push({
				id: `tool-result:${entry.message.toolCallId}`,
				kind: "tool_result",
				entryId: entry.id,
				summary: `${entry.message.toolName} ${entry.message.isError ? "error" : "success"} result`,
				retrieveWhen: `Need exact raw output from ${entry.message.toolName}.`,
			});
		} else if (entry.type === "message" && entry.message.role === "bashExecution") {
			pointers.push({
				id: `bash:${entry.id}`,
				kind: "bash",
				entryId: entry.id,
				summary: `Bash command: ${entry.message.command}`,
				retrieveWhen: "Need exact bash command output.",
			});
		}
	}
	for (const file of input.readFiles ?? []) {
		pointers.push({
			id: `file:${createStableId("path", file)}`,
			kind: "file",
			path: file,
			summary: `Read file ${file}`,
			retrieveWhen: "Need exact file content read earlier in the session.",
		});
	}
	return pointers;
}

function mergeCanonicalRequest(
	state: StructuredSessionState,
	patch: Partial<StructuredSessionState["canonicalRequest"]>,
): void {
	if (patch.current && patch.current !== state.canonicalRequest.current) {
		if (state.canonicalRequest.current) {
			state.canonicalRequest.superseded.push({
				old: state.canonicalRequest.current,
				replacedBy: patch.current,
				reason: "Compaction summary updated canonical goal.",
				entryId: patch.sourceEntryIds?.at(-1) ?? "",
			});
		}
		state.canonicalRequest.current = patch.current;
	}
	state.canonicalRequest.sourceEntryIds = mergeStringList(state.canonicalRequest.sourceEntryIds, patch.sourceEntryIds);
	state.canonicalRequest.originalRequests = mergeOriginalRequests(
		state.canonicalRequest.originalRequests ?? [],
		patch.originalRequests ?? [],
	);
	state.canonicalRequest.superseded = [...state.canonicalRequest.superseded, ...(patch.superseded ?? [])];
}

function mergeOriginalRequests(
	existing: OriginalUserRequest[],
	incoming: OriginalUserRequest[],
): OriginalUserRequest[] {
	const byId = new Map(existing.map((request) => [request.id, { ...request }]));
	for (const request of incoming) {
		byId.set(request.id, { ...request });
	}
	return [...byId.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function mergeConstraints(state: StructuredSessionState, patch: NonNullable<StatePatch["constraints"]>): void {
	const byId = new Map(state.constraints.map((constraint) => [constraint.id, constraint]));
	for (const constraint of patch.add ?? []) {
		if (!byId.has(constraint.id)) {
			state.constraints.push({ ...constraint });
			byId.set(constraint.id, constraint);
		}
	}
	for (const update of patch.update ?? []) {
		const current = byId.get(update.id);
		if (!current) continue;
		if (current.status === "active" && update.patch.status && update.patch.status !== "active") {
			continue;
		}
		Object.assign(current, update.patch);
	}
}

function mergePlan(state: StructuredSessionState, patch: NonNullable<StatePatch["plan"]>): void {
	const byId = new Map(state.plan.map((item) => [item.id, item]));
	for (const item of patch.add ?? []) {
		const existing = byId.get(item.id);
		if (!existing) {
			state.plan.push({ ...item, evidenceEntryIds: [...item.evidenceEntryIds] });
			byId.set(item.id, item);
			continue;
		}
		if (item.status === "done" && item.evidenceEntryIds.length === 0) continue;
		if (shouldReplacePlanStatus(existing.status, item.status)) {
			existing.status = item.status;
		}
		existing.text = item.text;
		existing.evidenceEntryIds = mergeStringList(existing.evidenceEntryIds, item.evidenceEntryIds);
	}
	for (const update of patch.update ?? []) {
		const existing = byId.get(update.id);
		if (!existing) continue;
		if (update.status === "done" && (update.evidenceEntryIds?.length ?? existing.evidenceEntryIds.length) === 0) {
			continue;
		}
		if (update.text) existing.text = update.text;
		if (update.status && shouldReplacePlanStatus(existing.status, update.status)) existing.status = update.status;
		existing.evidenceEntryIds = mergeStringList(existing.evidenceEntryIds, update.evidenceEntryIds);
	}
}

function shouldReplacePlanStatus(current: PlanStatus, incoming: PlanStatus): boolean {
	if (current === incoming) return true;
	if (current === "done" && incoming !== "done") return false;
	if ((current === "blocked" || current === "failed") && incoming === "not_started") return false;
	return true;
}

function mergeDecisions(state: StructuredSessionState, patch: NonNullable<StatePatch["decisions"]>): void {
	const byId = new Map(state.decisions.map((decision) => [decision.id, decision]));
	for (const item of patch.add ?? []) {
		if (!byId.has(item.id)) {
			state.decisions.push({
				...item,
				evidencePointers: item.evidencePointers.map((pointer) => ({ ...pointer })),
			});
		}
	}
	for (const supersede of patch.supersede ?? []) {
		const current = byId.get(supersede.id);
		if (current) {
			current.status = "superseded";
			current.rationale = current.rationale
				? `${current.rationale} Superseded: ${supersede.reason}`
				: `Superseded: ${supersede.reason}`;
		}
	}
}

function mergeTouchedFiles(existing: TouchedFile[], incoming: TouchedFile[]): TouchedFile[] {
	const byPath = new Map(existing.map((file) => [file.path, file]));
	for (const file of incoming) {
		const current = byPath.get(file.path);
		if (!current) {
			existing.push({ ...file });
			byPath.set(file.path, file);
			continue;
		}
		if (file.status !== "read" || current.status === "read") {
			current.status = file.status;
		}
		current.summary = file.summary;
	}
	return existing;
}

function mergeRelevantSymbols(existing: RelevantSymbol[], incoming: RelevantSymbol[]): RelevantSymbol[] {
	const seen = new Set(existing.map((symbol) => `${symbol.file}:${symbol.name}`));
	for (const symbol of incoming) {
		const key = `${symbol.file}:${symbol.name}`;
		if (!seen.has(key)) {
			existing.push({ ...symbol });
			seen.add(key);
		}
	}
	return existing;
}

function mergeEvidence(existing: EvidencePointer[], incoming: EvidencePointer[]): EvidencePointer[] {
	const seen = new Set(existing.map((pointer) => pointer.id));
	for (const pointer of incoming) {
		if (!seen.has(pointer.id)) {
			existing.push({ ...pointer });
			seen.add(pointer.id);
		}
	}
	return existing;
}

function mergeStringList(existing: string[], incoming: string[] | undefined): string[] {
	if (!incoming) return existing;
	const seen = new Set(existing);
	const result = [...existing];
	for (const item of incoming) {
		const trimmed = item.trim();
		if (trimmed && !seen.has(trimmed)) {
			result.push(trimmed);
			seen.add(trimmed);
		}
	}
	return result;
}

function extractOptionalBulletLines(text: string | undefined): string[] | undefined {
	return text === undefined ? undefined : extractBulletLines(text);
}

function extractBulletLines(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("- "))
		.map((line) =>
			line
				.slice(2)
				.replace(/^\[[ .vx-]\]\s*/i, "")
				.trim(),
		)
		.filter((line) => line.length > 0 && line !== "(none)");
}

function extractOptionalNumberedLines(text: string | undefined): string[] | undefined {
	return text === undefined ? undefined : extractNumberedLines(text);
}

function extractNumberedLines(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.map((line) => {
			const numbered = line.match(/^\d+[.)]\s+(.+)$/);
			if (numbered) return numbered[1].trim();
			const bullet = line.match(/^-\s+(.+)$/);
			if (bullet) return bullet[1].trim();
			return line;
		})
		.filter((line) => line.length > 0 && line !== "(none)");
}

function parsePlanStatus(value: string): PlanStatus {
	switch (value.toLowerCase()) {
		case ".":
			return "in_progress";
		case "v":
		case "x":
			return "done";
		case "-":
			return "failed";
		default:
			return "not_started";
	}
}

function renderPlanStatus(status: PlanStatus): string {
	switch (status) {
		case "done":
			return "done";
		case "in_progress":
			return "in_progress";
		case "failed":
			return "failed";
		case "blocked":
			return "blocked";
		case "not_started":
			return "not_started";
	}
}

function renderList(items: string[]): string[] {
	if (items.length === 0) return ["- (none)"];
	return items.map((item) => `- ${item}`);
}

function capPromptLine(text: string, maxChars: number): string {
	return capSentence(compactWhitespace(text), maxChars);
}

function capCheckpoint(checkpoint: string, maxTokens: number): string {
	const maxChars = Math.max(500, maxTokens * 4);
	if (checkpoint.length <= maxChars) return checkpoint;
	const suffix = "\nKnown risks:\n- checkpoint truncated to fit rendered state budget\n</session_checkpoint>";
	const prefix = checkpoint.slice(0, Math.max(0, maxChars - suffix.length));
	const lastLineBreak = prefix.lastIndexOf("\n");
	return `${prefix.slice(0, lastLineBreak > 0 ? lastLineBreak : prefix.length)}${suffix}`;
}

function createStableId(prefix: string, text: string): string {
	let hash = 2166136261;
	for (let index = 0; index < text.length; index++) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return `${prefix}-${(hash >>> 0).toString(16)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getMessageTextForState(message: AgentMessage): string {
	switch (message.role) {
		case "user":
			return typeof message.content === "string"
				? message.content
				: message.content
						.filter((block) => block.type === "text")
						.map((block) => block.text)
						.join("\n");
		case "assistant":
			return message.content
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("\n");
		case "toolResult":
			return message.content
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("\n");
		case "bashExecution":
			return `${message.command}\n${message.output}`;
		case "custom":
			return typeof message.content === "string"
				? message.content
				: message.content
						.filter((block) => block.type === "text")
						.map((block) => block.text)
						.join("\n");
		case "branchSummary":
		case "compactionSummary":
			return message.summary;
	}
}
