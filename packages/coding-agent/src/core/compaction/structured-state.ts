import type { AgentMessage } from "@dst0/p-agent-core";
import type { SessionEntry } from "../session-manager.ts";
import type { CompactionAudit, EvidencePointer } from "./compaction.ts";

export const STRUCTURED_SESSION_STATE_CUSTOM_TYPE = "pi.structured-session-state";
export const STRUCTURED_SESSION_STATE_VERSION = 1;
export const SESSION_STATE_UPDATE_START_TAG = "<session_state_update>";
export const SESSION_STATE_UPDATE_END_TAG = "</session_state_update>";
export const STATE_RENDER_MARKERS = {
	goal: "🚩",
	notStarted: "•",
	inProgress: "⏳",
	done: "✅",
	failed: "❌",
	blocked: "🚧",
	risk: "⚠️",
} as const;
const MAX_CANONICAL_REQUEST_CHARS = 480;
const MAX_REQUEST_SUMMARY_CHARS = 280;

export type ConstraintSource = "user" | "system" | "project" | "inferred";
export type ConstraintStatus = "active" | "superseded" | "rejected";
export type ConstraintEnforceability = "prompt" | "runtime_check" | "test" | "manual";
export type PlanStatus = "not_started" | "in_progress" | "done" | "failed" | "blocked";
export type FileTouchStatus = "read" | "modified" | "created" | "deleted";
type EvidenceKind = EvidencePointer["kind"];

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
		replace?: PlanItem[];
		add?: PlanItem[];
		update?: Array<{
			id: string;
			matchText?: string;
			status?: PlanStatus;
			text?: string;
			evidenceEntryIds?: string[];
		}>;
		remove?: Array<string | { id?: string; text: string }>;
	};
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

export interface ParsedSessionStateUpdateBlock {
	strippedText: string;
	patch?: StatePatch;
	malformed: boolean;
	error?: string;
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
			superseded: previous.canonicalRequest.superseded.map((item) => ({
				...item,
			})),
		},
		constraints: previous.constraints.map((constraint) => ({ ...constraint })),
		plan: previous.plan.map((item) => ({
			...item,
			evidenceEntryIds: [...item.evidenceEntryIds],
		})),
		decisions: previous.decisions.map((decision) => ({
			...decision,
			evidencePointers: decision.evidencePointers.map((pointer) => ({
				...pointer,
			})),
		})),
		codebase: {
			touchedFiles: previous.codebase.touchedFiles.map((file) => ({ ...file })),
			relevantSymbols: previous.codebase.relevantSymbols.map((symbol) => ({
				...symbol,
			})),
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

	next.codebase.touchedFiles = mergeTouchedFiles(next.codebase.touchedFiles, []);

	// Filter dead evidence and prune to max 50
	next.evidence = next.evidence
		.filter((e) => {
			const pathEmpty = e.path !== undefined && e.path.trim().length === 0;
			const isFile = e.kind === "file";
			const hasPath = e.path && e.path.trim().length > 0;
			const hasEntryId = e.entryId && e.entryId.trim().length > 0;
			const isToolResult = e.kind === "tool_result";
			return (
				e.id && !pathEmpty && (!isFile || hasPath) && (hasEntryId || hasPath || isToolResult || !e.retrieveWhen)
			);
		})
		.slice(-50);

	return next;
}

export function findMatchingPlanItem(plan: PlanItem[], text: string): PlanItem | undefined {
	return findPlanItemByIdOrText(plan, undefined, text);
}

export function renderStructuredSessionCheckpoint(state: StructuredSessionState, maxTokens: number): string {
	const plan = state.plan
		.slice(0, 12)
		.map((item) => `${renderPlanStatusMarker(item.status)} ${capPromptLine(item.text, 220)}`);
	const decisions = state.decisions
		.filter((decision) => decision.status === "active")
		.slice(-8)
		.map((decision) =>
			capPromptLine(`${decision.decision}${decision.rationale ? `: ${decision.rationale}` : ""}`, 240),
		);
	const touchedFiles = state.codebase.touchedFiles
		.slice(-20)
		.map((file) => `${file.status}: ${file.path} - ${capPromptLine(file.summary, 180)}`);
	const knownRisks = state.audit.knownRisks.map((risk) => `${STATE_RENDER_MARKERS.risk} ${capPromptLine(risk, 220)}`);
	const lines = [
		"<session_checkpoint>",
		`${STATE_RENDER_MARKERS.goal} Goal: ${
			capPromptLine(normalizeCanonicalRequest(state.canonicalRequest.current), 520) ||
			"(no user request recorded yet)"
		}`,
		"Plan:",
		...(plan.length > 0 ? plan : [`${STATE_RENDER_MARKERS.notStarted} (none)`]),
		"Decisions:",
		...renderList(decisions),
		"Files:",
		...renderList(touchedFiles),
		"Risks:",
		...renderList(knownRisks),
		"</session_checkpoint>",
	];
	return capCheckpoint(lines.join("\n"), maxTokens);
}

export function renderWorkingSessionState(state: StructuredSessionState, maxTokens: number): string | undefined {
	if (!hasMeaningfulStructuredSessionState(state)) {
		return undefined;
	}
	const plan = state.plan
		.slice(0, 12)
		.map((item) => `${renderPlanStatusMarker(item.status)} ${capPromptLine(item.text, 220)}`);
	const touchedFiles = state.codebase.touchedFiles
		.slice(-16)
		.map((file) => `${file.status}: ${file.path} - ${capPromptLine(file.summary, 180)}`);
	const risks = state.audit.knownRisks.map((risk) => `${STATE_RENDER_MARKERS.risk} ${capPromptLine(risk, 220)}`);
	const decisions = state.decisions
		.filter((decision) => decision.status === "active")
		.slice(-8)
		.map((decision) =>
			capPromptLine(`${decision.decision}${decision.rationale ? `: ${decision.rationale}` : ""}`, 240),
		);
	const lines = [
		"<working_state>",
		`${STATE_RENDER_MARKERS.goal} Goal: ${
			capPromptLine(normalizeCanonicalRequest(state.canonicalRequest.current), 520) ||
			"(no user request recorded yet)"
		}`,
		"Plan:",
		...(plan.length > 0 ? plan : [`${STATE_RENDER_MARKERS.notStarted} (none)`]),
		"Decisions:",
		...renderList(decisions),
		"Files:",
		...renderList(touchedFiles),
		"Risks:",
		...renderList(risks),
		"</working_state>",
	];
	return capWorkingState(lines.join("\n"), maxTokens);
}

export function hasMeaningfulStructuredSessionState(state: StructuredSessionState): boolean {
	return (
		state.canonicalRequest.current.trim().length > 0 ||
		(state.canonicalRequest.originalRequests?.length ?? 0) > 0 ||
		state.constraints.length > 0 ||
		state.plan.length > 0 ||
		state.decisions.length > 0 ||
		state.codebase.touchedFiles.length > 0 ||
		state.evidence.length > 0 ||
		state.audit.knownRisks.length > 0
	);
}

export function renderPlanStatusMarker(status: PlanStatus): string {
	switch (status) {
		case "done":
			return STATE_RENDER_MARKERS.done;
		case "in_progress":
			return STATE_RENDER_MARKERS.inProgress;
		case "failed":
			return STATE_RENDER_MARKERS.failed;
		case "blocked":
			return STATE_RENDER_MARKERS.blocked;
		case "not_started":
			return STATE_RENDER_MARKERS.notStarted;
	}
}

export function stripSessionStateUpdateBlocks(text: string): string {
	return text.replace(createSessionStateUpdateBlockRegex(), "").trim();
}

export function parseSessionStateUpdateBlock(
	text: string,
	sourceEntryIds: string[] = [],
): ParsedSessionStateUpdateBlock {
	const matches = [...text.matchAll(createSessionStateUpdateBlockRegex())];
	if (matches.length === 0) {
		return { strippedText: text, malformed: false };
	}
	let patch: StatePatch | undefined;
	let malformed = false;
	let error: string | undefined;
	for (const match of matches) {
		const rawJson = match[1]?.trim() ?? "";
		try {
			const parsed: unknown = JSON.parse(rawJson);
			const nextPatch = createStatePatchFromSessionStateUpdate(parsed, sourceEntryIds);
			if (nextPatch) {
				patch = mergeStatePatches(patch, nextPatch);
			}
		} catch (caught) {
			malformed = true;
			error = caught instanceof Error ? caught.message : String(caught);
		}
	}
	return {
		strippedText: stripSessionStateUpdateBlocks(text),
		patch,
		malformed,
		error,
	};
}

function createSessionStateUpdateBlockRegex(): RegExp {
	return /<session_state_update>\s*([\s\S]*?)\s*<\/session_state_update>/g;
}

function createStatePatchFromSessionStateUpdate(value: unknown, sourceEntryIds: string[]): StatePatch | undefined {
	if (!isRecord(value)) {
		throw new Error("session_state_update must be an object");
	}
	if (value.type === "none") {
		return undefined;
	}
	if (value.type !== "patch") {
		throw new Error("session_state_update type must be none or patch");
	}

	const goal = normalizePatchGoal(getStringField(value, ["goal", "canonicalGoal", "canonicalRequest"]));
	const constraints = parseConstraints(value.constraints);
	const action = getStringField(value, ["action"]);
	const isReplaceAction = action === "initial_plan";
	const planItems = parsePlanItemsFromUpdate(value.plan ?? value.planItems, sourceEntryIds);
	const decisions = parseDecisionsFromUpdate(value.decisions);
	const touchedFiles = parseTouchedFilesFromUpdate(value.touchedFiles ?? value.touched_files ?? value.files);
	const plan =
		planItems.length > 0
			? isReplaceAction
				? { replace: planItems }
				: (() => {
						const addItems = planItems.filter((i) => !i.op || i.op === "add");
						const updateItems = planItems
							.filter((i) => i.op === "update")
							.map((i) => ({
								id: i.id,
								matchText: i.text,
								text: i.text,
								status: i.status,
								evidenceEntryIds: i.evidenceEntryIds,
							}));
						const removeItems = planItems
							.filter((i) => i.op === "remove")
							.map((i) => ({ id: i.id, text: i.text }));
						const p: NonNullable<StatePatch["plan"]> = {};
						if (addItems.length > 0) p.add = addItems;
						if (updateItems.length > 0) p.update = updateItems;
						if (removeItems.length > 0) p.remove = removeItems;
						return Object.keys(p).length > 0 ? p : undefined;
					})()
			: undefined;
	const evidence = parseEvidenceFromUpdate(value.evidence ?? value.evidencePointers ?? value.evidence_pointers);
	const risks = getStringListField(value, ["risks", "knownRisks", "known_risks"]);
	const patch: StatePatch = {
		canonicalRequest: goal
			? {
					current: capSentence(compactWhitespace(goal), MAX_CANONICAL_REQUEST_CHARS),
					sourceEntryIds,
				}
			: undefined,
		constraints: constraints.length > 0 ? { add: constraints } : undefined,
		plan,
		decisions: decisions.length > 0 ? { add: decisions } : undefined,
		codebase: touchedFiles.length > 0 ? { touchedFiles, relevantSymbols: [] } : undefined,
		evidence: evidence.length > 0 ? { add: evidence } : undefined,
		audit: risks.length > 0 ? { knownRisks: risks } : undefined,
	};
	return hasStatePatchContent(patch) ? patch : undefined;
}

function mergeStatePatches(existing: StatePatch | undefined, incoming: StatePatch): StatePatch {
	if (!existing) return incoming;
	return {
		canonicalRequest: incoming.canonicalRequest ?? existing.canonicalRequest,
		constraints:
			existing.constraints || incoming.constraints
				? {
						add: [...(existing.constraints?.add ?? []), ...(incoming.constraints?.add ?? [])],
						update: [...(existing.constraints?.update ?? []), ...(incoming.constraints?.update ?? [])],
					}
				: undefined,
		plan:
			existing.plan || incoming.plan
				? {
						replace: incoming.plan?.replace ?? existing.plan?.replace,
						add: [...(existing.plan?.add ?? []), ...(incoming.plan?.add ?? [])],
						update: [...(existing.plan?.update ?? []), ...(incoming.plan?.update ?? [])],
					}
				: undefined,

		decisions:
			existing.decisions || incoming.decisions
				? {
						add: [...(existing.decisions?.add ?? []), ...(incoming.decisions?.add ?? [])],
						supersede: [...(existing.decisions?.supersede ?? []), ...(incoming.decisions?.supersede ?? [])],
					}
				: undefined,
		codebase:
			existing.codebase || incoming.codebase
				? {
						touchedFiles: [
							...(existing.codebase?.touchedFiles ?? []),
							...(incoming.codebase?.touchedFiles ?? []),
						],
						relevantSymbols: [
							...(existing.codebase?.relevantSymbols ?? []),
							...(incoming.codebase?.relevantSymbols ?? []),
						],
					}
				: undefined,
		evidence:
			existing.evidence || incoming.evidence
				? {
						add: [...(existing.evidence?.add ?? []), ...(incoming.evidence?.add ?? [])],
					}
				: undefined,
		audit:
			existing.audit || incoming.audit
				? {
						...existing.audit,
						...incoming.audit,
						knownRisks: mergeStringList(existing.audit?.knownRisks ?? [], incoming.audit?.knownRisks),
					}
				: undefined,
	};
}

function parseConstraints(value: unknown): Constraint[] {
	if (!Array.isArray(value)) return [];
	const constraints: Constraint[] = [];
	for (const item of value) {
		const text = typeof item === "string" ? item : isRecord(item) ? getStringField(item, ["text", "constraint"]) : "";
		if (!text) continue;
		const source = isRecord(item) ? parseConstraintSource(item.source) : "inferred";
		const status = isRecord(item) ? parseConstraintStatus(item.status) : "active";
		const enforceability = isRecord(item) ? parseConstraintEnforceability(item.enforceability) : "prompt";
		const id = isRecord(item)
			? getStringField(item, ["id"]) || createStableId("constraint", text)
			: createStableId("constraint", text);
		constraints.push({
			id,
			text: capSentence(compactWhitespace(text), 320),
			source,
			status,
			enforceability,
		});
	}
	return constraints;
}

function parsePlanItemsFromUpdate(
	value: unknown,
	sourceEntryIds: string[],
): Array<PlanItem & { op?: "add" | "update" | "remove" }> {
	const rawItems = Array.isArray(value)
		? value
		: isRecord(value) && Array.isArray(value.items)
			? value.items
			: isRecord(value) && Array.isArray(value.add)
				? value.add
				: [];
	const items: Array<PlanItem & { op?: "add" | "update" | "remove" }> = [];
	for (const item of rawItems) {
		const text =
			typeof item === "string" ? item : isRecord(item) ? getStringField(item, ["text", "item", "task"]) : "";
		if (!text) continue;
		const status = isRecord(item) ? parsePlanStatusValue(item.status ?? item.state) : "not_started";
		const op = isRecord(item)
			? (getStringField(item, ["op", "operation"]) as "add" | "update" | "remove" | undefined)
			: undefined;
		const entryIds = isRecord(item) ? getStringListField(item, ["evidenceEntryIds", "evidence_entry_ids"]) : [];
		items.push({
			id: isRecord(item)
				? getStringField(item, ["id"]) || createStableId("plan", text)
				: createStableId("plan", text),
			text: capSentence(compactWhitespace(text), 280),
			status,
			op,
			evidenceEntryIds: mergeStringList([...sourceEntryIds], entryIds),
		});
	}
	return items;
}

function parseDecisionsFromUpdate(value: unknown): Decision[] {
	if (!Array.isArray(value)) return [];
	const decisions: Decision[] = [];
	for (const item of value) {
		const decision =
			typeof item === "string" ? item : isRecord(item) ? getStringField(item, ["decision", "text", "summary"]) : "";
		if (!decision) continue;
		const rationale = isRecord(item) ? getStringField(item, ["rationale", "reason"]) : "";
		decisions.push({
			id: isRecord(item)
				? getStringField(item, ["id"]) || createStableId("decision", decision)
				: createStableId("decision", decision),
			decision: capSentence(compactWhitespace(decision), 260),
			rationale: capSentence(compactWhitespace(rationale), 320),
			evidencePointers: [],
			status: "active",
		});
	}
	return decisions;
}

function parseTouchedFilesFromUpdate(value: unknown): TouchedFile[] {
	if (!Array.isArray(value)) return [];
	const files: TouchedFile[] = [];
	for (const item of value) {
		const path = typeof item === "string" ? item : isRecord(item) ? getStringField(item, ["path", "file"]) : "";
		if (!path) continue;
		files.push({
			path,
			status: isRecord(item) ? parseFileTouchStatus(item.status) : "modified",
			summary: isRecord(item)
				? getStringField(item, ["summary", "reason"]) || "Touched during this session."
				: "Touched during this session.",
		});
	}
	return files;
}

function parseEvidenceFromUpdate(value: unknown): EvidencePointer[] {
	if (!Array.isArray(value)) return [];
	const pointers: EvidencePointer[] = [];
	for (const item of value) {
		const summary =
			typeof item === "string"
				? item
				: isRecord(item)
					? getStringField(item, ["summary", "text", "description"])
					: "";
		if (!summary) continue;
		const path = isRecord(item) ? getStringField(item, ["path"]) : "";
		pointers.push({
			id: isRecord(item)
				? getStringField(item, ["id"]) || createStableId("evidence", `${path}:${summary}`)
				: createStableId("evidence", summary),
			kind: isRecord(item) ? parseEvidenceKind(item.kind) : "message",
			entryId: isRecord(item) ? getStringField(item, ["entryId", "entry_id"]) || undefined : undefined,
			path: path || undefined,
			summary: capSentence(compactWhitespace(summary), 260),
			retrieveWhen: isRecord(item)
				? getStringField(item, ["retrieveWhen", "retrieve_when"]) || "Need exact supporting evidence."
				: "Need exact supporting evidence.",
		});
	}
	return pointers;
}

function hasStatePatchContent(patch: StatePatch): boolean {
	return (
		patch.canonicalRequest !== undefined ||
		(patch.constraints?.add?.length ?? 0) > 0 ||
		(patch.constraints?.update?.length ?? 0) > 0 ||
		(patch.plan?.replace?.length ?? 0) > 0 ||
		(patch.plan?.add?.length ?? 0) > 0 ||
		(patch.plan?.update?.length ?? 0) > 0 ||
		(patch.decisions?.add?.length ?? 0) > 0 ||
		(patch.decisions?.supersede?.length ?? 0) > 0 ||
		(patch.codebase?.touchedFiles?.length ?? 0) > 0 ||
		(patch.codebase?.relevantSymbols?.length ?? 0) > 0 ||
		(patch.evidence?.add?.length ?? 0) > 0 ||
		patch.audit !== undefined
	);
}

function getStringField(record: Record<string, unknown>, keys: string[]): string {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim().length > 0) {
			return value.trim();
		}
		if (isRecord(value) && typeof value.current === "string" && value.current.trim().length > 0) {
			return value.current.trim();
		}
	}
	return "";
}

function getStringListField(record: Record<string, unknown>, keys: string[]): string[] {
	for (const key of keys) {
		const value = record[key];
		const parsed = parseStringList(value);
		if (parsed.length > 0) return parsed;
	}
	return [];
}

function parseStringList(value: unknown): string[] {
	if (typeof value === "string" && value.trim().length > 0) {
		return [value.trim()];
	}
	if (!Array.isArray(value)) return [];
	return value
		.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
		.map((item) => item.trim());
}

function parsePlanStatusValue(value: unknown): PlanStatus {
	if (typeof value !== "string") return "not_started";
	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/[\s-]+/g, "_");
	switch (normalized) {
		case STATE_RENDER_MARKERS.done:
		case "done":
		case "complete":
		case "completed":
			return "done";
		case STATE_RENDER_MARKERS.inProgress:
		case "in_progress":
		case "current":
		case "active":
			return "in_progress";
		case STATE_RENDER_MARKERS.failed:
		case "failed":
		case "fail":
			return "failed";
		case STATE_RENDER_MARKERS.blocked:
		case "blocked":
		case "blocker":
			return "blocked";
		case STATE_RENDER_MARKERS.notStarted:
		case "not_started":
		case "todo":
		case "pending":
			return "not_started";
		default:
			return parsePlanStatus(value);
	}
}

function parseConstraintSource(value: unknown): ConstraintSource {
	return value === "user" || value === "system" || value === "project" || value === "inferred" ? value : "inferred";
}

function parseConstraintStatus(value: unknown): ConstraintStatus {
	return value === "active" || value === "superseded" || value === "rejected" ? value : "active";
}

function parseConstraintEnforceability(value: unknown): ConstraintEnforceability {
	return value === "prompt" || value === "runtime_check" || value === "test" || value === "manual" ? value : "prompt";
}

function parseFileTouchStatus(value: unknown): FileTouchStatus {
	return value === "read" || value === "modified" || value === "created" || value === "deleted" ? value : "modified";
}

function parseEvidenceKind(value: unknown): EvidenceKind {
	return value === "message" ||
		value === "tool_result" ||
		value === "bash" ||
		value === "file" ||
		value === "web" ||
		value === "artifact"
		? value
		: "message";
}

function createStatePatchFromSummary(input: StructuredStateUpdateInput): StatePatch {
	const timestamp = input.timestamp ?? new Date().toISOString();
	const sourceEntryIds = input.entries.map((entry) => entry.id).filter((id) => id.length > 0);
	const summaryGoal = extractSection(input.summary, "Goal").trim();
	const originalRequests = collectOriginalUserRequests(
		input.entries,
		input.previous?.canonicalRequest.originalRequests,
	);
	const latestCorrection = [...originalRequests].reverse().find((request) => request.kind === "correction");
	const latestRequest = [...originalRequests].reverse().find((request) => request.kind !== "correction");
	const latestActionableRequest = findLatestActionableRequest(originalRequests);
	const normalizedSummaryGoal = normalizeCanonicalRequest(summaryGoal);
	const goal =
		normalizeCanonicalRequest(latestCorrection?.summary ?? "") ||
		normalizeCanonicalRequest(latestActionableRequest?.summary ?? "") ||
		(isPlaceholderGoal(normalizedSummaryGoal) ? "" : normalizedSummaryGoal) ||
		normalizeCanonicalRequest(input.previous?.canonicalRequest.current ?? "") ||
		normalizeCanonicalRequest(latestRequest?.summary ?? "") ||
		createPlainSummaryFallback(input.summary);
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
	const originalRequests = collectOriginalUserRequests(
		input.entries,
		input.previous?.canonicalRequest.originalRequests,
	);
	const latestCorrection = [...originalRequests].reverse().find((request) => request.kind === "correction");
	const latestRequest = [...originalRequests].reverse().find((request) => request.kind !== "correction");
	const latestActionableRequest = findLatestActionableRequest(originalRequests);
	const previousGoal = normalizeCanonicalRequest(input.previous?.canonicalRequest.current ?? "");
	const preservePreviousGoal = hasDurablePreviousGoal(input.previous);
	const goal =
		normalizeCanonicalRequest(latestCorrection?.summary ?? "") ||
		(preservePreviousGoal ? "" : normalizeCanonicalRequest(latestActionableRequest?.summary ?? "")) ||
		previousGoal ||
		normalizeCanonicalRequest(latestRequest?.summary ?? "");
	const liveMarkdown = createLiveConversationMarkdown(input.entries);
	const planItems = extractPlanItems(liveMarkdown, sourceEntryIds);
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
		decisions: decisions.length > 0 ? { add: decisions } : undefined,
		evidence: evidence.length > 0 ? { add: evidence } : undefined,
	};
}

function hasDurablePreviousGoal(previous: StructuredSessionState | undefined): boolean {
	if (!previous?.canonicalRequest.current.trim()) return false;
	return (
		(previous.canonicalRequest.originalRequests?.length ?? 0) > 0 ||
		previous.plan.length > 0 ||
		previous.decisions.length > 0 ||
		previous.codebase.touchedFiles.length > 0 ||
		previous.evidence.length > 0 ||
		previous.audit.knownRisks.length > 0
	);
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
	const normalized = compactWhitespace(goal).toLowerCase();
	return (
		/^(awaiting|waiting for) (initial )?user (prompt|input|request)\b/i.test(normalized) ||
		/^no conversation provided\b/i.test(normalized) ||
		/^(no goal|none|n\/a|unknown|not set|unchanged|same as before)\.?$/i.test(normalized)
	);
}

function normalizePatchGoal(goal: string): string {
	const normalized = normalizeCanonicalRequest(goal);
	return isPlaceholderGoal(normalized) ? "" : normalized;
}

function collectOriginalUserRequests(
	entries: SessionEntry[],
	existingRequests?: OriginalUserRequest[],
): OriginalUserRequest[] {
	const requests: OriginalUserRequest[] = [];
	const existingCount = existingRequests?.length ?? 0;
	for (const entry of entries) {
		if (entry.type !== "message" || entry.message.role !== "user") continue;
		const text = getAgentMessageText(entry.message).trim();
		if (!text) continue;
		const kind = classifyUserRequest(text, requests.length);
		const reqIndex = existingCount + requests.length + 1;
		requests.push({
			id: `req-${reqIndex}`,
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

function findLatestActionableRequest(requests: OriginalUserRequest[]): OriginalUserRequest | undefined {
	return [...requests]
		.reverse()
		.find((request) => request.kind !== "correction" && isActionableUserRequestSummary(request.summary));
}

function isActionableUserRequestSummary(summary: string): boolean {
	const normalized = compactWhitespace(summary).toLowerCase();
	if (!normalized) return false;
	if (/^turn\s+\d+\s+of\s+\d+\b/.test(normalized)) return true;
	if (normalized.length < 24) return false;
	if (
		/^(continue|continue again|keep going|go on|next|proceed|resume|retry|again|ok|okay|yes|good|world|hello|hi|do it)\.?$/i.test(
			normalized,
		)
	) {
		return false;
	}
	return /\b(add|analy[sz]e|build|change|check|commit|convert|create|deploy|finish|fix|implement|install|investigate|make|read|remove|rename|report|run|test|update|use|verify|write)\b/i.test(
		normalized,
	);
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

function extractPlanItems(markdown: string, sourceEntryIds: string[]): PlanItem[] {
	const section = [extractOptionalSection(markdown, "Plan"), ...extractLooseSections(markdown, ["Plan"])]
		.filter((value): value is string => value !== undefined && value.trim().length > 0)
		.join("\n");
	const items: PlanItem[] = [];
	const seen = new Set<string>();
	for (const rawLine of section.split("\n")) {
		const line = rawLine.trim();
		const checkboxMatch = line.match(/^-\s+\[([ .vx!-])\]\s+(.+)$/i);
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

function createLiveConversationMarkdown(entries: SessionEntry[]): string {
	const messages: string[] = [];
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		if (entry.message.role !== "assistant" && entry.message.role !== "custom") continue;
		const text = stripStructuredContextBlocks(getAgentMessageText(entry.message)).trim();
		if (text) {
			messages.push(text);
		}
	}
	return messages.slice(-12).join("\n\n");
}

function stripStructuredContextBlocks(text: string): string {
	return stripSessionStateUpdateBlocks(text)
		.replace(/<session_checkpoint>[\s\S]*?<\/session_checkpoint>/g, "")
		.replace(/<working_state>[\s\S]*?<\/working_state>/g, "")
		.trim();
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
	const current = normalizePatchGoal(patch.current ?? "");
	if (current && current !== state.canonicalRequest.current) {
		if (state.canonicalRequest.current) {
			state.canonicalRequest.superseded.push({
				old: state.canonicalRequest.current,
				replacedBy: current,
				reason: "Compaction summary updated canonical goal.",
				entryId: patch.sourceEntryIds?.at(-1) ?? "",
			});
		}
		state.canonicalRequest.current = current;
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

/**
 * Prunes dead evidenceEntryIds from plan items.
 * Removes entryIds that don't match any evidence pointer.
 */
function pruneEvidenceEntryIds(plan: PlanItem[], evidence: EvidencePointer[]): void {
	const evidenceIds = new Set(evidence.map((e) => e.id));
	for (const item of plan) {
		item.evidenceEntryIds = item.evidenceEntryIds.filter((id) => evidenceIds.has(id));
	}
}

function mergePlan(state: StructuredSessionState, patch: NonNullable<StatePatch["plan"]>): void {
	// Fast path: when there are no existing items, all incoming items are new
	if (state.plan.length === 0 && (patch.replace?.length ?? 0) === 0) {
		state.plan = (patch.add ?? []).map(
			(item): PlanItem => ({
				id: item.id,
				text: item.text,
				status: item.status,
				evidenceEntryIds: item.evidenceEntryIds ?? [],
			}),
		);
		return;
	}

	const orderedIds: string[] = [];
	const rememberOrder = (item: PlanItem): void => {
		if (!orderedIds.includes(item.id)) {
			orderedIds.push(item.id);
		}
	};
	if (patch.replace) {
		const nextPlan: PlanItem[] = [];
		for (const item of patch.replace) {
			const existing = findPlanItemByIdOrText(state.plan, item.id, item.text);
			nextPlan.push({
				...(existing ?? item),
				id: existing?.id ?? item.id,
				text: item.text,
				status: item.status,
				evidenceEntryIds: mergeStringList(existing?.evidenceEntryIds ?? [], item.evidenceEntryIds),
			});
		}
		state.plan = nextPlan;
	}
	for (const item of patch.add ?? []) {
		const existing = findPlanItemByIdOrText(state.plan, item.id, item.text);
		if (!existing) {
			const added = {
				...item,
				evidenceEntryIds: [...item.evidenceEntryIds],
			};
			state.plan.push(added);
			rememberOrder(added);
			continue;
		}
		if (item.status === "done" && item.evidenceEntryIds.length === 0) continue;
		if (shouldReplacePlanStatus(existing.status, item.status)) {
			existing.status = item.status;
		}
		if (existing.id === item.id) {
			existing.text = item.text;
		}
		existing.evidenceEntryIds = mergeStringList(existing.evidenceEntryIds, item.evidenceEntryIds);
		rememberOrder(existing);
	}
	for (const update of patch.update ?? []) {
		const existing = findPlanItemByIdOrText(state.plan, update.id, update.matchText ?? update.text ?? "");
		if (!existing) continue;
		if (update.status === "done" && (update.evidenceEntryIds?.length ?? existing.evidenceEntryIds.length) === 0) {
			continue;
		}
		if (update.text && existing.id === update.id) {
			existing.text = update.text;
		}
		if (update.status && shouldReplacePlanStatus(existing.status, update.status)) existing.status = update.status;
		existing.evidenceEntryIds = mergeStringList(existing.evidenceEntryIds, update.evidenceEntryIds);
		rememberOrder(existing);
	}
	// Remove items matched by id or text
	for (const removal of patch.remove ?? []) {
		const matchId = typeof removal === "string" ? undefined : removal.id;
		const matchText = typeof removal === "string" ? removal : removal.text;
		state.plan = state.plan.filter((item) => !findPlanItemByIdOrText([item], matchId, matchText));
	}
	if ((patch.add?.length ?? 0) > 1 && orderedIds.length > 1) {
		reorderPlan(state, orderedIds);
	}
	// Prune dead evidenceEntryIds (entryIds that don't match any evidence pointer)
	pruneEvidenceEntryIds(state.plan, state.evidence);
}

function findPlanItemByIdOrText(plan: PlanItem[], id: string | undefined, text: string): PlanItem | undefined {
	if (id) {
		const byId = plan.find((item) => item.id === id);
		if (byId) return byId;
	}
	const normalizedText = normalizeComparableText(text);
	if (!normalizedText) return undefined;
	const exactText = plan.find((item) => normalizeComparableText(item.text) === normalizedText);
	if (exactText) return exactText;

	let best: { item: PlanItem; score: number } | undefined;
	for (const item of plan) {
		const score = scoreComparableText(item.text, text);
		if (score < 0.66) continue;
		if (!best || score > best.score) {
			best = { item, score };
		}
	}
	return best?.item;
}

function reorderPlan(state: StructuredSessionState, orderedIds: string[]): void {
	const order = new Map(orderedIds.map((id, index) => [id, index]));
	state.plan = [...state.plan].sort((left, right) => {
		const leftOrder = order.get(left.id);
		const rightOrder = order.get(right.id);
		if (leftOrder === undefined && rightOrder === undefined) return 0;
		if (leftOrder === undefined) return 1;
		if (rightOrder === undefined) return -1;
		return leftOrder - rightOrder;
	});
}

function shouldReplacePlanStatus(current: PlanStatus, incoming: PlanStatus): boolean {
	if (current === incoming) return true;
	if (current === "done" && incoming !== "done") return false;
	if ((current === "blocked" || current === "failed") && incoming === "not_started") return false;
	if (current === "in_progress" && incoming === "not_started") return false;
	return true;
}

function mergeDecisions(state: StructuredSessionState, patch: NonNullable<StatePatch["decisions"]>): void {
	const byId = new Map(state.decisions.map((decision) => [decision.id, decision]));
	for (const item of patch.add ?? []) {
		const existing =
			byId.get(item.id) ??
			state.decisions.find(
				(decision) =>
					normalizeComparableText(decision.decision) === normalizeComparableText(item.decision) &&
					normalizeComparableText(decision.rationale) === normalizeComparableText(item.rationale),
			);
		if (existing) {
			existing.evidencePointers = mergeEvidence(existing.evidencePointers, item.evidencePointers);
			continue;
		}
		state.decisions.push({
			...item,
			evidencePointers: item.evidencePointers.map((pointer) => ({
				...pointer,
			})),
		});
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

/**
 * Normalizes a file path for session state storage:
 * - Filters out /tmp/ scratch files
 * - Converts absolute paths to relative paths (keeps only basename for absolute paths outside cwd)
 * Returns null if the file should be filtered out.
 */
function normalizeFilePath(filePath: string): string | null {
	// Filter out /tmp/ scratch files
	if (filePath.startsWith("/tmp/") || filePath.startsWith("/var/folders/")) {
		return null;
	}

	// Convert absolute paths to relative (basename for paths outside project)
	if (filePath.startsWith("/")) {
		const parts = filePath.split("/");
		// Keep relative-like paths (e.g., "packages/foo/bar.ts") but not deep absolute paths
		if (parts.length <= 4) {
			// Short absolute path, keep as-is but strip leading /
			return filePath.slice(1);
		}
		// Deep absolute path - use basename to avoid leaking project paths
		return parts[parts.length - 1];
	}

	return filePath;
}

function mergeTouchedFiles(existing: TouchedFile[], incoming: TouchedFile[]): TouchedFile[] {
	const byPath = new Map<string, TouchedFile>();

	// Process existing files with normalization
	for (const file of existing) {
		const normalized = normalizeFilePath(file.path);
		if (normalized === null) continue; // skip filtered files
		const entry = { ...file, path: normalized };
		if (!byPath.has(normalized) || entry.summary.length > byPath.get(normalized)!.summary.length) {
			byPath.set(normalized, entry);
		}
	}

	// Process incoming files with normalization
	for (const file of incoming) {
		const normalized = normalizeFilePath(file.path);
		if (normalized === null) continue; // skip filtered files
		const entry = { ...file, path: normalized };
		if (!byPath.has(normalized) || entry.summary.length > byPath.get(normalized)!.summary.length) {
			byPath.set(normalized, entry);
		}
	}

	return Array.from(byPath.values());
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

function mergeEvidence(
	existing: EvidencePointer[],
	incoming: EvidencePointer[],
	maxKeep: number = 50,
): EvidencePointer[] {
	const indexById = new Map<string, number>();
	const result: EvidencePointer[] = [];

	// Process existing pointers, filtering dead references
	for (const pointer of existing) {
		// Filter out dead references (no entryId, no path, has retrieveWhen)
		const pathEmpty = pointer.path !== undefined && pointer.path.trim().length === 0;
		const isFile = pointer.kind === "file";
		const hasPath = pointer.path && pointer.path.trim().length > 0;
		const hasEntryId = pointer.entryId && pointer.entryId.trim().length > 0;
		const isToolResult = pointer.kind === "tool_result";
		if (
			!pointer.id ||
			pathEmpty ||
			(isFile && !hasPath) ||
			(!hasEntryId && !hasPath && !isToolResult && pointer.retrieveWhen)
		) {
			continue;
		}
		indexById.set(pointer.id, result.length);
		result.push({ ...pointer });
	}

	// Process incoming pointers
	for (const pointer of incoming) {
		// Filter out dead references
		const pathEmpty = pointer.path !== undefined && pointer.path.trim().length === 0;
		const isFile = pointer.kind === "file";
		const hasPath = pointer.path && pointer.path.trim().length > 0;
		const hasEntryId = pointer.entryId && pointer.entryId.trim().length > 0;
		const isToolResult = pointer.kind === "tool_result";
		if (
			!pointer.id ||
			pathEmpty ||
			(isFile && !hasPath) ||
			(!hasEntryId && !hasPath && !isToolResult && pointer.retrieveWhen)
		) {
			continue;
		}
		const existingIndex = indexById.get(pointer.id);
		if (existingIndex === undefined) {
			result.push({ ...pointer });
			indexById.set(pointer.id, result.length - 1);
		} else {
			const current = result[existingIndex];
			if (
				pointer.summary.length > (current?.summary.length ?? 0) ||
				pointer.retrieveWhen.length > (current?.retrieveWhen.length ?? 0)
			) {
				result[existingIndex] = { ...pointer };
			}
		}
	}

	// Prune to maxKeep, keeping most recent
	if (result.length > maxKeep) {
		return result.slice(result.length - maxKeep);
	}
	return result;
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

function scoreComparableText(left: string, right: string): number {
	const normalizedLeft = normalizeComparableText(left);
	const normalizedRight = normalizeComparableText(right);
	if (!normalizedLeft || !normalizedRight) return 0;
	const leftTerms = comparableTerms(normalizedLeft);
	const rightTerms = comparableTerms(normalizedRight);
	return _scoreNormalizedComparableText(normalizedLeft, leftTerms, normalizedRight, rightTerms);
}

function _scoreNormalizedComparableText(
	normalizedLeft: string,
	leftTerms: Set<string>,
	normalizedRight: string,
	rightTerms: Set<string>,
): number {
	if (normalizedLeft === normalizedRight) return 1;
	if (normalizedLeft.length >= 12 && normalizedRight.length >= 12) {
		if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
			return 0.95;
		}
	}
	if (leftTerms.size === 0 || rightTerms.size === 0) return 0;
	let shared = 0;
	for (const term of leftTerms) {
		if (rightTerms.has(term)) {
			shared++;
		}
	}
	if (shared < 2) return 0;
	const containment = shared / Math.min(leftTerms.size, rightTerms.size);
	const dice = (2 * shared) / (leftTerms.size + rightTerms.size);
	return Math.max(containment >= 0.8 ? containment : 0, dice);
}

// Optimization: cache comparable terms to avoid splitting and mapping repetitively
const termsCache = new Map<string, Set<string>>();
const TERM_SPLIT_REGEX = /[^a-z0-9/_-]+/;

function comparableTerms(text: string): Set<string> {
	let cached = termsCache.get(text);
	if (cached !== undefined) return cached;

	// Reset cache if it gets too large to prevent memory leak
	if (termsCache.size > 2000) termsCache.clear();

	cached = new Set(
		text
			.split(TERM_SPLIT_REGEX)
			.map((term) => term.trim())
			.filter((term) => term.length > 1 && !COMPARABLE_TEXT_STOP_WORDS.has(term)),
	);
	termsCache.set(text, cached);
	return cached;
}

const COMPARABLE_TEXT_STOP_WORDS = new Set([
	"a",
	"an",
	"and",
	"for",
	"in",
	"of",
	"on",
	"or",
	"the",
	"to",
	"with",
	"without",
]);

// ⚡ Bolt: Extract regexes to module level to avoid allocation overhead in hot loops
const NORMALIZE_PREFIX_REGEX = /^(?:(?:✅|⏳|•|➖|❌|🚧|📌|🚩|⚠️)|[\s-])+/gu;
const NORMALIZE_ACTION_REGEX =
	/^(?:impl|implement|explore|check|verify|run|change|find|fix|investigate|update|create)\s*:\s*/g;
const NORMALIZE_PARENS_REGEX = /\([^)]*\)\s*$/g;
const NORMALIZE_SPACE_REGEX = /\s+/g;

// Optimization: cache normalized text as it is called many times in nested loops
const normalizationCache = new Map<string, string>();

function normalizeComparableText(text: string): string {
	let cached = normalizationCache.get(text);
	if (cached !== undefined) return cached;

	// Reset cache if it gets too large to prevent memory leak
	if (normalizationCache.size > 2000) normalizationCache.clear();

	cached = text
		.toLowerCase()
		.replace(NORMALIZE_PREFIX_REGEX, "")
		.replace(NORMALIZE_ACTION_REGEX, "")
		.replace(NORMALIZE_PARENS_REGEX, "")
		.replace(NORMALIZE_SPACE_REGEX, " ")
		.trim();
	normalizationCache.set(text, cached);
	return cached;
}

function extractBulletLines(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("- "))
		.map((line) =>
			line
				.slice(2)
				.replace(/^\[[ .vx!-]\]\s*/i, "")
				.trim(),
		)
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
		case "!":
			return "blocked";
		default:
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
	const suffix = `\nRisks:\n- ${STATE_RENDER_MARKERS.risk} checkpoint truncated to fit rendered state budget\n</session_checkpoint>`;
	const prefix = checkpoint.slice(0, Math.max(0, maxChars - suffix.length));
	const lastLineBreak = prefix.lastIndexOf("\n");
	return `${prefix.slice(0, lastLineBreak > 0 ? lastLineBreak : prefix.length)}${suffix}`;
}

function capWorkingState(workingState: string, maxTokens: number): string {
	const maxChars = Math.max(500, maxTokens * 4);
	if (workingState.length <= maxChars) return workingState;
	const suffix = `\nRisks:\n- ${STATE_RENDER_MARKERS.risk} working state truncated to fit rendered state budget\n</working_state>`;
	const prefix = workingState.slice(0, Math.max(0, maxChars - suffix.length));
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
