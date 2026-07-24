import type {
	AfterToolCallContext,
	AfterToolCallResult,
	Agent,
	BeforeToolCallContext,
	BeforeToolCallResult,
} from "@dst0/p-agent-core";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "./extensions/types.ts";
import type { SessionManager } from "./session-manager.ts";

export const TASK_VERIFICATION_TOOL_NAME = "record_task_verification";
export const TASK_VERIFICATION_STATE_CUSTOM_TYPE = "task_verification_state";
export const TASK_VERIFICATION_EVIDENCE_CUSTOM_TYPE = "task_verification_evidence";

const TASK_KINDS = ["bug_fix", "behavior_change", "refactor", "feature", "docs", "investigation"] as const;
const BASELINE_METHODS = ["runtime_reproduction", "failing_regression_test", "static_trace"] as const;
const FINAL_METHODS = ["focused_test", "test_suite", "manual_reproduction", "static_review"] as const;

type TaskKind = (typeof TASK_KINDS)[number];
type BaselineMethod = (typeof BASELINE_METHODS)[number];
type FinalMethod = (typeof FINAL_METHODS)[number];

export interface TaskVerificationState {
	version: 1;
	taskKind?: TaskKind;
	taskSummary?: string;
	mutationRevision: number;
	baseline: {
		required: boolean;
		status: "not_required" | "pending" | "satisfied";
		hypothesis?: string;
		conclusion?: string;
		method?: BaselineMethod;
		evidenceRefs: string[];
	};
	final: {
		status: "pending" | "passed" | "failed";
		expectedBehavior?: string;
		observedBehavior?: string;
		method?: FinalMethod;
		evidenceRefs: string[];
		unresolvedFailures: string[];
		verifiedMutationRevision?: number;
	};
	updatedAt: string;
}

export interface TaskVerificationEvidence {
	version: 1;
	ref: string;
	toolCallId: string;
	toolName: string;
	descriptor: string;
	outputSummary: string;
	isError: boolean;
	mutationRevision: number;
	timestamp: string;
}

const TaskKindSchema = Type.Union([
	Type.Literal("bug_fix"),
	Type.Literal("behavior_change"),
	Type.Literal("refactor"),
	Type.Literal("feature"),
	Type.Literal("docs"),
	Type.Literal("investigation"),
]);
const BaselineMethodSchema = Type.Union([
	Type.Literal("runtime_reproduction"),
	Type.Literal("failing_regression_test"),
	Type.Literal("static_trace"),
]);
const FinalMethodSchema = Type.Union([
	Type.Literal("focused_test"),
	Type.Literal("test_suite"),
	Type.Literal("manual_reproduction"),
	Type.Literal("static_review"),
]);
const VerificationSchema = Type.Object({
	action: Type.Union([
		Type.Literal("declare_task"),
		Type.Literal("record_baseline"),
		Type.Literal("record_final"),
		Type.Literal("status"),
	]),
	task_kind: Type.Optional(TaskKindSchema),
	task_summary: Type.Optional(Type.String()),
	hypothesis: Type.Optional(Type.String()),
	conclusion: Type.Optional(Type.String()),
	baseline_method: Type.Optional(BaselineMethodSchema),
	evidence_refs: Type.Optional(Type.Array(Type.String(), { minItems: 1 })),
	unresolved_assumptions: Type.Optional(Type.Array(Type.String())),
	expected_behavior: Type.Optional(Type.String()),
	observed_behavior: Type.Optional(Type.String()),
	final_method: Type.Optional(FinalMethodSchema),
	final_status: Type.Optional(Type.Union([Type.Literal("passed"), Type.Literal("failed")])),
	unresolved_failures: Type.Optional(Type.Array(Type.String())),
});
type VerificationInput = Static<typeof VerificationSchema>;
interface VerificationResult {
	status: "updated" | "rejected";
	message: string;
	state: TaskVerificationState;
}

const EVIDENCE_TOOLS = new Set(["read", "bash", "grep", "find", "ls", "semantic_search"]);
const STATIC_TOOLS = new Set(["read", "grep", "find", "ls", "semantic_search"]);
const MUTATING_TOOLS = new Set(["edit", "write"]);
const BUG_PATTERN = /\b(bug|fix|broken|regression|incorrect|wrong|failure|lost|crash|race|issue|repair)\b|(?:ошиб|баг|слом|невер|неправ|теря|паден|исправ)/iu;
const HIGH_RISK_PATTERN = /\b(sigterm|sigint|sigkill|signal|shutdown|restart|daemon|crash|recovery|resume|checkpoint|manifest|persist|durab|transaction|concurr|race|deadlock|indexing|refresh|migration)\b|(?:сигнал|завершен|перезапуск|демон|восстанов|чекпоинт|манифест|персист|транзакц|конкурент|гонк|индекс|миграц)/iu;
const BASH_MUTATION_PATTERN = /(?:^|[;&|]\s*)(?:sed\s+-i|perl\s+-[a-z]*i|patch\b|git\s+(?:apply|am|cherry-pick|merge|rebase|checkout|switch|reset|restore)\b|rm\b|mv\b|cp\b|touch\b|mkdir\b|truncate\b|tee\b|npm\s+(?:install|uninstall|update)\b|pnpm\s+(?:add|remove|install|update)\b|yarn\s+(?:add|remove|install|upgrade)\b|bun\s+(?:add|remove|install|update)\b|cargo\s+(?:add|remove|update)\b|node\s+scripts\/version-bump\.mjs\b|\.\/reinstall\.sh\b)/iu;
const WRITE_REDIRECT_PATTERN = /(?:^|[;&|]\s*)(?:echo|printf|cat)\b[^\n;]*(?:>|>>)\s*(?!\/dev\/null\b)/iu;
const PUBLISH_PATTERN = /(?:^|[;&|]\s*)git\s+(?:commit|push)\b/iu;
const GENERIC_CHECK_PATTERN = /^\s*(?:npm\s+run\s+check|pnpm\s+run\s+check|yarn\s+check|tsc\b|biome\b|eslint\b|prettier\b|cargo\s+(?:fmt|clippy)\b)/iu;
const READ_ONLY_PATTERN = /^\s*(?:pwd\b|ls\b|find\b|fd\b|rg\b|grep\b|cat\b|head\b|tail\b|git\s+(?:status|diff|show|log)\b)/iu;
const TEST_PATTERN = /\b(?:vitest|jest|pytest|cargo\s+test|go\s+test|bun\s+test|npm\s+test|pnpm\s+test|yarn\s+test|\.\/test\.sh)\b/iu;
const FOCUSED_TEST_PATTERN = /(?:test\/|tests\/|\.test\.[cm]?[jt]sx?|\.spec\.[cm]?[jt]sx?|--test-name-pattern\b|\s-t\s+\S+)/iu;

function emptyState(): TaskVerificationState {
	return {
		version: 1,
		mutationRevision: 0,
		baseline: { required: false, status: "not_required", evidenceRefs: [] },
		final: { status: "pending", evidenceRefs: [], unresolvedFailures: [] },
		updatedAt: new Date().toISOString(),
	};
}

function text(value: string | undefined): string {
	return value?.replace(/\s+/g, " ").trim() ?? "";
}
function strings(values: readonly string[] | undefined): string[] {
	return [...new Set((values ?? []).map(text).filter(Boolean))];
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isKind(value: unknown): value is TaskKind {
	return typeof value === "string" && (TASK_KINDS as readonly string[]).includes(value);
}
function isBaselineMethod(value: unknown): value is BaselineMethod {
	return typeof value === "string" && (BASELINE_METHODS as readonly string[]).includes(value);
}
function isFinalMethod(value: unknown): value is FinalMethod {
	return typeof value === "string" && (FINAL_METHODS as readonly string[]).includes(value);
}
function validState(value: unknown): value is TaskVerificationState {
	return isRecord(value) && value.version === 1 && typeof value.mutationRevision === "number" && isRecord(value.baseline) && isRecord(value.final);
}
function validEvidence(value: unknown): value is TaskVerificationEvidence {
	return isRecord(value) && value.version === 1 && typeof value.ref === "string" && typeof value.toolCallId === "string" && typeof value.toolName === "string" && typeof value.descriptor === "string" && typeof value.outputSummary === "string" && typeof value.isError === "boolean" && typeof value.mutationRevision === "number" && typeof value.timestamp === "string";
}
function argsRecord(args: unknown): Record<string, unknown> {
	return isRecord(args) ? args : {};
}
function command(args: unknown): string {
	const value = argsRecord(args).command;
	return typeof value === "string" ? value.trim() : "";
}
function isPublish(name: string, args: unknown): boolean {
	return name === "bash" && PUBLISH_PATTERN.test(command(args));
}
function isMutation(name: string, args: unknown): boolean {
	if (MUTATING_TOOLS.has(name)) return true;
	if (name !== "bash" || isPublish(name, args)) return false;
	const value = command(args);
	return BASH_MUTATION_PATTERN.test(value) || WRITE_REDIRECT_PATTERN.test(value);
}
function descriptor(name: string, args: unknown): string {
	if (name === "bash") return command(args) || "bash";
	const values = argsRecord(args);
	const detail = typeof values.path === "string" ? values.path : typeof values.query === "string" ? values.query : "";
	return detail ? `${name} ${detail}` : name;
}
function outputSummary(content: AfterToolCallContext["result"]["content"]): string {
	const value = content.filter((part) => part.type === "text").map((part) => part.text).join(" ").replace(/\s+/g, " ").trim();
	return value.length <= 500 ? value : `${value.slice(0, 499).trimEnd()}…`;
}
function needsBaseline(kind: TaskKind, taskText: string): boolean {
	return kind === "bug_fix" || kind === "behavior_change" || kind === "refactor" || BUG_PATTERN.test(taskText);
}
function needsBehavioralFinal(kind: TaskKind, taskText: string): boolean {
	return kind !== "docs" && kind !== "investigation" && (kind !== "feature" || BUG_PATTERN.test(taskText));
}

export class TaskVerificationController {
	readonly toolDefinition: ToolDefinition;
	private readonly sessionManager: SessionManager;
	private readonly evidence = new Map<string, TaskVerificationEvidence>();
	private state = emptyState();
	private latestUserPrompt = "";
	private nextEvidence = 1;
	private installed = false;

	constructor(sessionManager: SessionManager) {
		this.sessionManager = sessionManager;
		this.restore();
		this.toolDefinition = this.createToolDefinition() as unknown as ToolDefinition;
	}

	get currentState(): TaskVerificationState {
		return structuredClone(this.state);
	}

	install(agent: Agent): void {
		if (this.installed) return;
		this.installed = true;
		const before = agent.beforeToolCall;
		const after = agent.afterToolCall;
		agent.beforeToolCall = async (context, signal) => {
			const gate = this.before(context);
			return gate?.block ? gate : before?.(context, signal);
		};
		agent.afterToolCall = async (context, signal) => this.after(context, await after?.(context, signal));
		agent.subscribe((event) => {
			if (event.type !== "message_start" || event.message.role !== "user") return;
			const content = event.message.content;
			this.latestUserPrompt = typeof content === "string" ? content : content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
			if (this.state.final.status === "passed") {
				this.state = emptyState();
				this.persistState();
			}
		});
	}

	private createToolDefinition(): ToolDefinition<typeof VerificationSchema, VerificationResult> {
		return {
			name: TASK_VERIFICATION_TOOL_NAME,
			label: "Task Verification",
			description: "Record evidence-backed baseline and final semantic verification for mutating tasks.",
			promptSnippet: "record_task_verification(action, ...): declare mutation intent, prove baseline behavior, and prove final behavior after the last mutation.",
			promptGuidelines: [
				`Before edit, write, or mutating bash, call ${TASK_VERIFICATION_TOOL_NAME} with action \"declare_task\".`,
				"Bug fixes, behavior changes, and refactors require evidence-backed baseline verification before mutation.",
				"Signal, restart, persistence, recovery, transaction, concurrency, migration, and indexing tasks require runtime reproduction or a failing focused regression test.",
				"After the last mutation, record fresh behavior-specific verification. Generic check/lint output is not semantic proof.",
				"Successful finish_work and git commit/push are blocked until final verification passes for the current mutation revision.",
			],
			parameters: VerificationSchema,
			executionMode: "sequential",
			execute: async (_id, params) => {
				const result = this.apply(params);
				return { content: [{ type: "text", text: result.message }], details: result };
			},
		};
	}

	private before(context: BeforeToolCallContext): BeforeToolCallResult | undefined {
		const name = context.toolCall.name;
		if (isPublish(name, context.args)) return this.gate("publish changes");
		if (name === "finish_work" && argsRecord(context.args).status !== "partial" && argsRecord(context.args).status !== "failed") return this.gate("finish successfully");
		if (!isMutation(name, context.args)) return undefined;
		if (!this.state.taskKind) return { block: true, reason: `Call ${TASK_VERIFICATION_TOOL_NAME} with action \"declare_task\" before mutating code.` };
		if (this.state.baseline.required && this.state.baseline.status !== "satisfied") return { block: true, reason: `Collect baseline evidence and call ${TASK_VERIFICATION_TOOL_NAME} with action \"record_baseline\" before implementation.` };
		return undefined;
	}

	private async after(context: AfterToolCallContext, prior: AfterToolCallResult | undefined): Promise<AfterToolCallResult | undefined> {
		const isError = prior?.isError ?? context.isError;
		if (!isError && isMutation(context.toolCall.name, context.args)) {
			this.state = { ...this.state, mutationRevision: this.state.mutationRevision + 1, final: { status: "pending", evidenceRefs: [], unresolvedFailures: [] }, updatedAt: new Date().toISOString() };
			this.persistState();
			return prior;
		}
		if (!EVIDENCE_TOOLS.has(context.toolCall.name) || isMutation(context.toolCall.name, context.args)) return prior;
		const content = prior?.content ?? context.result.content;
		const item: TaskVerificationEvidence = {
			version: 1,
			ref: `verification-evidence-${this.nextEvidence++}`,
			toolCallId: context.toolCall.id,
			toolName: context.toolCall.name,
			descriptor: descriptor(context.toolCall.name, context.args),
			outputSummary: outputSummary(content),
			isError,
			mutationRevision: this.state.mutationRevision,
			timestamp: new Date().toISOString(),
		};
		this.evidence.set(item.ref, item);
		this.sessionManager.appendCustomEntry(TASK_VERIFICATION_EVIDENCE_CUSTOM_TYPE, item);
		const result: AfterToolCallResult = { content: [...content, { type: "text", text: `Verification evidence handle: ${item.ref} (${item.toolName}, mutation revision ${item.mutationRevision}).` }], isError };
		if (prior?.details !== undefined) result.details = prior.details;
		else if (context.result.details !== undefined) result.details = context.result.details;
		if (prior?.terminate !== undefined) result.terminate = prior.terminate;
		return result;
	}

	private apply(input: VerificationInput): VerificationResult {
		if (input.action === "declare_task") return this.declareTask(input);
		if (input.action === "record_baseline") return this.recordBaseline(input);
		if (input.action === "record_final") return this.recordFinal(input);
		return this.ok(this.status());
	}

	private declareTask(input: VerificationInput): VerificationResult {
		if (!isKind(input.task_kind) || !text(input.task_summary)) return this.no("declare_task requires task_kind and a concrete task_summary.");
		if (this.state.mutationRevision > 0) return this.no("Cannot replace the task declaration after mutation; finish the current task first.");
		const summary = text(input.task_summary);
		const required = needsBaseline(input.task_kind, `${this.latestUserPrompt}\n${summary}`);
		this.state = { ...emptyState(), taskKind: input.task_kind, taskSummary: summary, baseline: { required, status: required ? "pending" : "not_required", evidenceRefs: [] }, updatedAt: new Date().toISOString() };
		this.persistState();
		return this.ok(required ? "Task declared; baseline verification is required before mutation." : "Task declared; final verification is required after mutation.");
	}

	private recordBaseline(input: VerificationInput): VerificationResult {
		if (!this.state.taskKind || !this.state.taskSummary) return this.no("Declare the task before baseline verification.");
		if (!isBaselineMethod(input.baseline_method) || !text(input.hypothesis) || !text(input.conclusion)) return this.no("record_baseline requires baseline_method, hypothesis, and conclusion.");
		if (strings(input.unresolved_assumptions).length) return this.no("Baseline verification cannot pass with unresolved assumptions.");
		const evidence = this.resolve(input.evidence_refs);
		if (typeof evidence === "string") return this.no(evidence);
		if (evidence.some((item) => item.mutationRevision !== 0)) return this.no("Baseline evidence must come from mutation revision 0.");
		const taskText = `${this.latestUserPrompt}\n${this.state.taskSummary}`;
		if (input.baseline_method === "static_trace") {
			if (HIGH_RISK_PATTERN.test(taskText)) return this.no("Static trace is insufficient for signal/restart/persistence/recovery/concurrency/indexing work.");
			if (evidence.filter((item) => !item.isError && STATIC_TOOLS.has(item.toolName)).length < 2) return this.no("static_trace requires two non-error inspection evidence handles.");
		}
		if (input.baseline_method === "runtime_reproduction" && !evidence.some((item) => item.toolName === "bash" && !item.isError && !GENERIC_CHECK_PATTERN.test(item.descriptor) && !READ_ONLY_PATTERN.test(item.descriptor))) return this.no("runtime_reproduction requires successful non-generic bash evidence exercising the behavior.");
		if (input.baseline_method === "failing_regression_test" && !evidence.some((item) => item.toolName === "bash" && item.isError && TEST_PATTERN.test(item.descriptor) && FOCUSED_TEST_PATTERN.test(item.descriptor))) return this.no("failing_regression_test requires a failing focused-test evidence handle.");
		this.state = { ...this.state, baseline: { required: this.state.baseline.required, status: "satisfied", hypothesis: text(input.hypothesis), conclusion: text(input.conclusion), method: input.baseline_method, evidenceRefs: evidence.map((item) => item.ref) }, updatedAt: new Date().toISOString() };
		this.persistState();
		return this.ok("Baseline verification recorded; mutation is unblocked.");
	}

	private recordFinal(input: VerificationInput): VerificationResult {
		if (!this.state.taskKind || !this.state.taskSummary || this.state.mutationRevision === 0) return this.no("Final verification requires a declared task and at least one mutation.");
		if (!isFinalMethod(input.final_method) || (input.final_status !== "passed" && input.final_status !== "failed")) return this.no("record_final requires final_method and final_status.");
		const expected = text(input.expected_behavior);
		const observed = text(input.observed_behavior);
		if (!expected || !observed) return this.no("record_final requires expected_behavior and observed_behavior.");
		const failures = strings(input.unresolved_failures);
		const evidence = this.resolve(input.evidence_refs);
		if (typeof evidence === "string") return this.no(evidence);
		if (evidence.some((item) => item.mutationRevision !== this.state.mutationRevision)) return this.no(`Final evidence is stale; all handles must come from mutation revision ${this.state.mutationRevision}.`);
		if (input.final_status === "failed") {
			this.state = { ...this.state, final: { status: "failed", expectedBehavior: expected, observedBehavior: observed, method: input.final_method, evidenceRefs: evidence.map((item) => item.ref), unresolvedFailures: failures, verifiedMutationRevision: this.state.mutationRevision }, updatedAt: new Date().toISOString() };
			this.persistState();
			return this.ok("Final verification recorded as failed; successful completion remains blocked.");
		}
		if (failures.length || evidence.some((item) => item.isError)) return this.no("Passed final verification cannot contain unresolved failures or failed evidence.");
		const taskText = `${this.latestUserPrompt}\n${this.state.taskSummary}`;
		const behavioral = needsBehavioralFinal(this.state.taskKind, taskText);
		if (input.final_method === "static_review" && (behavioral || evidence.filter((item) => STATIC_TOOLS.has(item.toolName)).length < 2)) return this.no("static_review cannot prove behavioral code changes and otherwise requires two inspection handles.");
		if (input.final_method === "focused_test" && !evidence.some((item) => item.toolName === "bash" && TEST_PATTERN.test(item.descriptor) && FOCUSED_TEST_PATTERN.test(item.descriptor))) return this.no("focused_test requires evidence from a specific test file or test name.");
		if (input.final_method === "test_suite" && (behavioral || HIGH_RISK_PATTERN.test(taskText) || !evidence.some((item) => item.toolName === "bash" && TEST_PATTERN.test(item.descriptor)))) return this.no("A broad test suite alone is insufficient for this behavioral task.");
		if (input.final_method === "manual_reproduction" && !evidence.some((item) => item.toolName === "bash" && !GENERIC_CHECK_PATTERN.test(item.descriptor) && !READ_ONLY_PATTERN.test(item.descriptor))) return this.no("manual_reproduction requires non-generic bash evidence exercising the changed behavior.");
		this.state = { ...this.state, final: { status: "passed", expectedBehavior: expected, observedBehavior: observed, method: input.final_method, evidenceRefs: evidence.map((item) => item.ref), unresolvedFailures: [], verifiedMutationRevision: this.state.mutationRevision }, updatedAt: new Date().toISOString() };
		this.persistState();
		return this.ok("Final semantic verification passed for the current mutation revision.");
	}

	private resolve(refs: readonly string[] | undefined): TaskVerificationEvidence[] | string {
		const values = strings(refs);
		if (!values.length) return "At least one evidence_refs handle is required.";
		const missing = values.filter((ref) => !this.evidence.has(ref));
		return missing.length ? `Unknown evidence handle(s): ${missing.join(", ")}.` : values.map((ref) => this.evidence.get(ref)!);
	}

	private gate(action: string): BeforeToolCallResult | undefined {
		if (this.state.mutationRevision === 0) return undefined;
		if (this.state.baseline.required && this.state.baseline.status !== "satisfied") return { block: true, reason: `Cannot ${action}: baseline verification is incomplete.` };
		if (this.state.final.status !== "passed" || this.state.final.verifiedMutationRevision !== this.state.mutationRevision) return { block: true, reason: `Cannot ${action}: semantic verification has not passed after mutation revision ${this.state.mutationRevision}.` };
		return undefined;
	}

	private restore(): void {
		for (const entry of this.sessionManager.getBranch()) {
			if (entry.type !== "custom") continue;
			if (entry.customType === TASK_VERIFICATION_STATE_CUSTOM_TYPE && validState(entry.data)) this.state = entry.data;
			if (entry.customType === TASK_VERIFICATION_EVIDENCE_CUSTOM_TYPE && validEvidence(entry.data)) {
				this.evidence.set(entry.data.ref, entry.data);
				const number = Number.parseInt(entry.data.ref.replace(/^verification-evidence-/, ""), 10);
				if (Number.isFinite(number)) this.nextEvidence = Math.max(this.nextEvidence, number + 1);
			}
		}
	}

	private persistState(): void {
		this.sessionManager.appendCustomEntry(TASK_VERIFICATION_STATE_CUSTOM_TYPE, this.state);
	}
	private status(): string {
		const recent = [...this.evidence.values()].slice(-8).map((item) => `${item.ref}: ${item.toolName} at revision ${item.mutationRevision}${item.isError ? " (failed)" : ""}`);
		return [`Task: ${this.state.taskKind ?? "undeclared"}${this.state.taskSummary ? ` — ${this.state.taskSummary}` : ""}`, `Mutation revision: ${this.state.mutationRevision}`, `Baseline: ${this.state.baseline.status}`, `Final: ${this.state.final.status}`, recent.length ? `Evidence:\n- ${recent.join("\n- ")}` : "Evidence: none"].join("\n");
	}
	private ok(message: string): VerificationResult {
		return { status: "updated", message, state: this.currentState };
	}
	private no(message: string): VerificationResult {
		return { status: "rejected", message, state: this.currentState };
	}
}

export function createTaskVerificationController(sessionManager: SessionManager): TaskVerificationController {
	return new TaskVerificationController(sessionManager);
}
