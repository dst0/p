import type {
	AfterToolCallContext,
	AfterToolCallResult,
	Agent,
	BeforeToolCallContext,
	BeforeToolCallResult,
} from "@dst0/p-agent-core";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "./extensions/types.ts";
import type { CustomEntry, SessionManager } from "./session-manager.ts";

export const TASK_VERIFICATION_TOOL_NAME = "record_task_verification";
export const TASK_VERIFICATION_STATE_CUSTOM_TYPE = "task_verification_state";
export const TASK_VERIFICATION_EVIDENCE_CUSTOM_TYPE = "task_verification_evidence";

const TASK_KINDS = ["bug_fix", "behavior_change", "refactor", "feature", "docs", "investigation"] as const;
const BASELINE_METHODS = ["runtime_reproduction", "failing_regression_test", "static_trace"] as const;
const FINAL_METHODS = ["focused_test", "test_suite", "manual_reproduction", "static_review"] as const;

export type TaskKind = (typeof TASK_KINDS)[number];
export type BaselineVerificationMethod = (typeof BASELINE_METHODS)[number];
export type FinalVerificationMethod = (typeof FINAL_METHODS)[number];

type BaselineStatus = "not_required" | "pending" | "satisfied";
type FinalStatus = "pending" | "passed" | "failed";

export interface TaskVerificationState {
	version: 1;
	taskKind?: TaskKind;
	taskSummary?: string;
	mutationRevision: number;
	baseline: {
		required: boolean;
		status: BaselineStatus;
		hypothesis?: string;
		conclusion?: string;
		method?: BaselineVerificationMethod;
		evidenceRefs: string[];
		unresolvedAssumptions: string[];
	};
	final: {
		status: FinalStatus;
		expectedBehavior?: string;
		observedBehavior?: string;
		method?: FinalVerificationMethod;
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

const TASK_KIND_SCHEMA = Type.Union([
	Type.Literal("bug_fix"),
	Type.Literal("behavior_change"),
	Type.Literal("refactor"),
	Type.Literal("feature"),
	Type.Literal("docs"),
	Type.Literal("investigation"),
]);
const BASELINE_METHOD_SCHEMA = Type.Union([
	Type.Literal("runtime_reproduction"),
	Type.Literal("failing_regression_test"),
	Type.Literal("static_trace"),
]);
const FINAL_METHOD_SCHEMA = Type.Union([
	Type.Literal("focused_test"),
	Type.Literal("test_suite"),
	Type.Literal("manual_reproduction"),
	Type.Literal("static_review"),
]);

const TASK_VERIFICATION_SCHEMA = Type.Object({
	action: Type.Union([
		Type.Literal("declare_task"),
		Type.Literal("record_baseline"),
		Type.Literal("record_final"),
		Type.Literal("status"),
	]),
	task_kind: Type.Optional(TASK_KIND_SCHEMA),
	task_summary: Type.Optional(Type.String()),
	hypothesis: Type.Optional(Type.String()),
	conclusion: Type.Optional(Type.String()),
	baseline_method: Type.Optional(BASELINE_METHOD_SCHEMA),
	evidence_refs: Type.Optional(Type.Array(Type.String(), { minItems: 1 })),
	unresolved_assumptions: Type.Optional(Type.Array(Type.String())),
	expected_behavior: Type.Optional(Type.String()),
	observed_behavior: Type.Optional(Type.String()),
	final_method: Type.Optional(FINAL_METHOD_SCHEMA),
	final_status: Type.Optional(Type.Union([Type.Literal("passed"), Type.Literal("failed")])),
	unresolved_failures: Type.Optional(Type.Array(Type.String())),
});

type TaskVerificationInput = Static<typeof TASK_VERIFICATION_SCHEMA>;

interface TaskVerificationToolResult {
	status: "updated" | "rejected";
	message: string;
	state: TaskVerificationState;
}

const MUTATION_TOOL_NAMES = new Set(["edit", "write"]);
const EVIDENCE_TOOL_NAMES = new Set(["read", "bash", "grep", "find", "ls", "semantic_search"]);
const METADATA_TOOL_NAMES = new Set([
	TASK_VERIFICATION_TOOL_NAME,
	"update_session_state",
	"mark_session_progress",
	"finish_work",
	"sleep",
	"keep_context",
	"tool_search",
]);
const STATIC_EVIDENCE_TOOL_NAMES = new Set(["read", "grep", "find", "ls", "semantic_search"]);

const BUG_LIKE_PATTERN =
	/\b(bug|fix|broken|regression|incorrect|wrong|failure|fails?|lost|crash|race|issue|problem|repair)\b|(?:ошиб|баг|слом|невер|неправ|теря|паден|проблем|исправ)|(?:помил|зламан|виправ)/iu;
const HIGH_RISK_PATTERN =
	/\b(sigterm|sigint|sigkill|signal|shutdown|restart|daemon|crash|recovery|recover|resume|checkpoint|manifest|persist|durab|transaction|concurr|race|deadlock|indexing|refresh|migration)\b|(?:сигнал|завершен|перезапуск|демон|восстанов|чекпоинт|манифест|персист|транзакц|конкурент|гонк|индекс|миграц)/iu;
const BASH_MUTATION_PATTERN =
	/(?:^|[;&|]\s*)(?:sed\s+-i|perl\s+-[a-z]*i|patch\b|git\s+(?:apply|am|cherry-pick|merge|rebase|checkout|switch|reset|restore)\b|rm\b|mv\b|cp\b|touch\b|mkdir\b|truncate\b|tee\b|npm\s+(?:install|uninstall|update)\b|pnpm\s+(?:add|remove|install|update)\b|yarn\s+(?:add|remove|install|upgrade)\b|bun\s+(?:add|remove|install|update)\b|cargo\s+(?:add|remove|update)\b|node\s+scripts\/version-bump\.mjs\b|\.\/reinstall\.sh\b)/iu;
const SHELL_WRITE_REDIRECT_PATTERN = /(?:^|[;&|]\s*)(?:echo|printf|cat)\b[^\n;]*(?:>|>>)\s*(?!\/dev\/null\b)/iu;
const PUBLISH_COMMAND_PATTERN = /(?:^|[;&|]\s*)git\s+(?:commit|push)\b/iu;
const GENERIC_CHECK_PATTERN =
	/^\s*(?:npm\s+run\s+check|pnpm\s+run\s+check|yarn\s+check|tsc\b|biome\b|eslint\b|prettier\b|cargo\s+(?:fmt|clippy)\b)/iu;
const TEST_COMMAND_PATTERN =
	/\b(?:vitest|jest|pytest|cargo\s+test|go\s+test|bun\s+test|npm\s+test|pnpm\s+test|yarn\s+test|\.\/test\.sh)\b/iu;
const FOCUSED_TEST_PATTERN =
	/(?:test\/|tests\/|\.test\.[cm]?[jt]sx?|\.spec\.[cm]?[jt]sx?|--test-name-pattern\b|\s-t\s+\S+)/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeText(value: string | undefined): string {
	return value?.replace(/\s+/g, " ").trim() ?? "";
}

function nonEmptyStrings(values: readonly string[] | undefined): string[] {
	return (values ?? []).map((value) => normalizeText(value)).filter((value) => value.length > 0);
}

function createEmptyState(): TaskVerificationState {
	return {
		version: 1,
		mutationRevision: 0,
		baseline: {
			required: false,
			status: "not_required",
			evidenceRefs: [],
			unresolvedAssumptions: [],
		},
		final: {
			status: "pending",
			evidenceRefs: [],
			unresolvedFailures: [],
		},
		updatedAt: new Date().toISOString(),
	};
}

function isTaskKind(value: unknown): value is TaskKind {
	return typeof value === "string" && (TASK_KINDS as readonly string[]).includes(value);
}

function isBaselineMethod(value: unknown): value is BaselineVerificationMethod {
	return typeof value === "string" && (BASELINE_METHODS as readonly string[]).includes(value);
}

function isFinalMethod(value: unknown): value is FinalVerificationMethod {
	return typeof value === "string" && (FINAL_METHODS as readonly string[]).includes(value);
}

function isTaskVerificationState(value: unknown): value is TaskVerificationState {
	if (!isRecord(value) || value.version !== 1 || typeof value.mutationRevision !== "number") return false;
	return isRecord(value.baseline) && isRecord(value.final);
}

function isTaskVerificationEvidence(value: unknown): value is TaskVerificationEvidence {
	return (
		isRecord(value) &&
		value.version === 1 &&
		typeof value.ref === "string" &&
		typeof value.toolCallId === "string" &&
		typeof value.toolName === "string" &&
		typeof value.descriptor === "string" &&
		typeof value.outputSummary === "string" &&
		typeof value.isError === "boolean" &&
		typeof value.mutationRevision === "number" &&
		typeof value.timestamp === "string"
	);
}

function getCustomEntryData(entry: CustomEntry): unknown {
	return entry.data;
}

function getToolArgsRecord(args: unknown): Record<string, unknown> {
	return isRecord(args) ? args : {};
}

function getBashCommand(args: unknown): string {
	const command = getToolArgsRecord(args).command;
	return typeof command === "string" ? command.trim() : "";
}

function isPublishCommand(toolName: string, args: unknown): boolean {
	return toolName === "bash" && PUBLISH_COMMAND_PATTERN.test(getBashCommand(args));
}

function isMutationTool(toolName: string, args: unknown): boolean {
	if (MUTATION_TOOL_NAMES.has(toolName)) return true;
	if (toolName !== "bash") return false;
	const command = getBashCommand(args);
	if (!command || isPublishCommand(toolName, args)) return false;
	return BASH_MUTATION_PATTERN.test(command) || SHELL_WRITE_REDIRECT_PATTERN.test(command);
}

function getFinishStatus(args: unknown): string {
	const status = getToolArgsRecord(args).status;
	return typeof status === "string" ? status : "success";
}

function describeToolCall(toolName: string, args: unknown): string {
	const record = getToolArgsRecord(args);
	if (toolName === "bash") return getBashCommand(args) || "bash";
	const path = record.path;
	if (typeof path === "string" && path.trim()) return `${toolName} ${path.trim()}`;
	const query = record.query;
	if (typeof query === "string" && query.trim()) return `${toolName} ${query.trim()}`;
	return toolName;
}

function extractOutputSummary(content: AfterToolCallContext["result"]["content"]): string {
	const text = content
		.filter((part): part is Extract<(typeof content)[number], { type: "text" }> => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.replace(/\s+/g, " ")
		.trim();
	return text.length <= 500 ? text : `${text.slice(0, 499).trimEnd()}…`;
}

function baselineRequired(taskKind: TaskKind, taskText: string): boolean {
	return (
		taskKind === "bug_fix" ||
		taskKind === "behavior_change" ||
		taskKind === "refactor" ||
		BUG_LIKE_PATTERN.test(taskText)
	);
}

function highRiskTask(taskText: string): boolean {
	return HIGH_RISK_PATTERN.test(taskText);
}

function requiresBehavioralFinalVerification(taskKind: TaskKind, taskText: string): boolean {
	return taskKind !== "docs" && taskKind !== "investigation" && (taskKind !== "feature" || BUG_LIKE_PATTERN.test(taskText));
}

function uniqueEvidenceRefs(refs: readonly string[]): string[] {
	return [...new Set(refs)];
}

export class TaskVerificationController {
	readonly toolDefinition: ToolDefinition<typeof TASK_VERIFICATION_SCHEMA, TaskVerificationToolResult>;

	private readonly evidence = new Map<string, TaskVerificationEvidence>();
	private state: TaskVerificationState;
	private latestUserPrompt = "";
	private nextEvidenceNumber = 1;
	private installed = false;

	constructor(private readonly sessionManager: SessionManager) {
		this.state = createEmptyState();
		this.restore();
		this.toolDefinition = this.createToolDefinition();
	}

	get currentState(): TaskVerificationState {
		return structuredClone(this.state);
	}

	install(agent: Agent): void {
		if (this.installed) return;
		this.installed = true;
		const previousBeforeToolCall = agent.beforeToolCall;
		const previousAfterToolCall = agent.afterToolCall;

		agent.beforeToolCall = async (context, signal) => {
			const previous = await previousBeforeToolCall?.(context, signal);
			if (previous?.block) return previous;
			return this.beforeToolCall(context);
		};

		agent.afterToolCall = async (context, signal) => {
			const previous = await previousAfterToolCall?.(context, signal);
			return this.afterToolCall(context, previous);
		};

		agent.subscribe((event) => {
			if (event.type !== "message_start" || event.message.role !== "user") return;
			const content = event.message.content;
			this.latestUserPrompt =
				typeof content === "string"
					? content
					: content
							.filter((part) => part.type === "text")
							.map((part) => part.text)
							.join("\n");
			if (this.state.final.status === "passed") this.state = createEmptyState();
		});
	}

	private restore(): void {
		for (const entry of this.sessionManager.getBranch()) {
			if (entry.type !== "custom") continue;
			if (entry.customType === TASK_VERIFICATION_STATE_CUSTOM_TYPE) {
				const data = getCustomEntryData(entry);
				if (isTaskVerificationState(data)) this.state = data;
				continue;
			}
			if (entry.customType !== TASK_VERIFICATION_EVIDENCE_CUSTOM_TYPE) continue;
			const data = getCustomEntryData(entry);
			if (!isTaskVerificationEvidence(data)) continue;
			this.evidence.set(data.ref, data);
			const numericPart = Number.parseInt(data.ref.replace(/^verification-evidence-/, ""), 10);
			if (Number.isFinite(numericPart)) this.nextEvidenceNumber = Math.max(this.nextEvidenceNumber, numericPart + 1);
		}
	}

	private createToolDefinition(): ToolDefinition<typeof TASK_VERIFICATION_SCHEMA, TaskVerificationToolResult> {
		return {
			name: TASK_VERIFICATION_TOOL_NAME,
			label: "Task Verification",
			description:
				"Declare mutating task intent, record evidence-backed baseline behavior before implementation, and record fresh semantic verification after the final mutation.",
			promptSnippet:
				"record_task_verification(action, ...): declare every mutating task, prove the baseline before bug/behavior/refactor edits, and prove final behavior after the last mutation.",
			promptGuidelines: [
				`Before edit, write, or a mutating bash command, call ${TASK_VERIFICATION_TOOL_NAME} with action "declare_task".`,
				"For bug fixes, behavior changes, and refactors, inspect or reproduce the current behavior first, then record_baseline using exact verification evidence handles emitted by tool results.",
				"Signal, shutdown, restart, persistence, recovery, transaction, concurrency, migration, and indexing tasks require runtime reproduction or a failing regression test; static_trace is insufficient.",
				"After the last mutation, run behavior-specific verification and record_final. Generic lint/typecheck output alone is not semantic proof for a bug fix.",
				"Successful finish_work and git commit/push remain blocked until final verification is passed for the current mutation revision.",
				`Use ${TASK_VERIFICATION_TOOL_NAME} with action "status" after compaction or resume to inspect the durable verification state and recent evidence handles.`,
			],
			parameters: TASK_VERIFICATION_SCHEMA,
			executionMode: "sequential",
			execute: async (_toolCallId, params) => {
				const result = this.applyToolInput(params);
				return {
					content: [{ type: "text", text: result.message }],
					details: result,
					isError: result.status === "rejected",
				};
			},
		};
	}

	private beforeToolCall(context: BeforeToolCallContext): BeforeToolCallResult | undefined {
		const { name } = context.toolCall;
		if (isPublishCommand(name, context.args)) {
			const reason = this.getFinalGateReason("publish changes");
			return reason ? { block: true, reason } : undefined;
		}
		if (name === "finish_work" && getFinishStatus(context.args) === "success") {
			const reason = this.getFinalGateReason("finish successfully");
			return reason ? { block: true, reason } : undefined;
		}
		if (!isMutationTool(name, context.args)) return undefined;
		if (!this.state.taskKind) {
			return {
				block: true,
				reason:
					`Before mutating code, call ${TASK_VERIFICATION_TOOL_NAME} with action "declare_task", ` +
					"a concrete task_kind, and task_summary.",
			};
		}
		if (this.state.baseline.required && this.state.baseline.status !== "satisfied") {
			return {
				block: true,
				reason:
					"Implementation is blocked until current behavior is established with evidence. " +
					`Collect baseline evidence and call ${TASK_VERIFICATION_TOOL_NAME} with action "record_baseline".`,
			};
		}
		return undefined;
	}

	private async afterToolCall(
		context: AfterToolCallContext,
		previous: AfterToolCallResult | undefined,
	): Promise<AfterToolCallResult | undefined> {
		const effectiveIsError = previous?.isError ?? context.isError;
		const effectiveContent = previous?.content ?? context.result.content;
		const effectiveDetails = previous?.details ?? context.result.details;
		const effectiveTerminate = previous?.terminate;
		const toolName = context.toolCall.name;

		if (!effectiveIsError && isMutationTool(toolName, context.args)) {
			this.state = {
				...this.state,
				mutationRevision: this.state.mutationRevision + 1,
				final: { status: "pending", evidenceRefs: [], unresolvedFailures: [] },
				updatedAt: new Date().toISOString(),
			};
			this.persistState();
			return previous;
		}

		if (METADATA_TOOL_NAMES.has(toolName) || isMutationTool(toolName, context.args) || !EVIDENCE_TOOL_NAMES.has(toolName)) {
			return previous;
		}

		const evidence = this.recordEvidence(context, effectiveContent, effectiveIsError);
		return {
			content: [
				...effectiveContent,
				{
					type: "text",
					text: `Verification evidence handle: ${evidence.ref} (${evidence.toolName}, mutation revision ${evidence.mutationRevision}).`,
				},
			],
			details: effectiveDetails,
			isError: effectiveIsError,
			terminate: effectiveTerminate,
		};
	}

	private recordEvidence(
		context: AfterToolCallContext,
		content: AfterToolCallContext["result"]["content"],
		isError: boolean,
	): TaskVerificationEvidence {
		const evidence: TaskVerificationEvidence = {
			version: 1,
			ref: `verification-evidence-${this.nextEvidenceNumber++}`,
			toolCallId: context.toolCall.id,
			toolName: context.toolCall.name,
			descriptor: describeToolCall(context.toolCall.name, context.args),
			outputSummary: extractOutputSummary(content),
			isError,
			mutationRevision: this.state.mutationRevision,
			timestamp: new Date().toISOString(),
		};
		this.evidence.set(evidence.ref, evidence);
		this.sessionManager.appendCustomEntry(TASK_VERIFICATION_EVIDENCE_CUSTOM_TYPE, evidence);
		return evidence;
	}

	private applyToolInput(input: TaskVerificationInput): TaskVerificationToolResult {
		switch (input.action) {
			case "declare_task":
				return this.declareTask(input);
			case "record_baseline":
				return this.recordBaseline(input);
			case "record_final":
				return this.recordFinal(input);
			case "status":
				return this.updated(this.formatStatus());
		}
	}

	private declareTask(input: TaskVerificationInput): TaskVerificationToolResult {
		if (!isTaskKind(input.task_kind)) return this.reject("declare_task requires task_kind.");
		const taskSummary = normalizeText(input.task_summary);
		if (!taskSummary) return this.reject("declare_task requires a concrete task_summary.");
		if (this.state.mutationRevision > 0) {
			return this.reject("Task declaration cannot be reset after code mutation. Finish the current task before declaring another one.");
		}
		const taskText = `${this.latestUserPrompt}\n${taskSummary}`;
		const required = baselineRequired(input.task_kind, taskText);
		this.state = {
			...createEmptyState(),
			taskKind: input.task_kind,
			taskSummary,
			baseline: {
				required,
				status: required ? "pending" : "not_required",
				evidenceRefs: [],
				unresolvedAssumptions: [],
			},
			updatedAt: new Date().toISOString(),
		};
		this.persistState();
		return this.updated(
			required
				? "Task declared. Baseline verification is required before mutation."
				: "Task declared. Baseline verification is not required; final verification will be required after mutation.",
		);
	}

	private recordBaseline(input: TaskVerificationInput): TaskVerificationToolResult {
		if (!this.state.taskKind || !this.state.taskSummary) return this.reject("Declare the task before recording baseline evidence.");
		if (!isBaselineMethod(input.baseline_method)) return this.reject("record_baseline requires baseline_method.");
		const hypothesis = normalizeText(input.hypothesis);
		const conclusion = normalizeText(input.conclusion);
		if (!hypothesis || !conclusion) return this.reject("record_baseline requires hypothesis and conclusion.");
		const unresolvedAssumptions = nonEmptyStrings(input.unresolved_assumptions);
		if (unresolvedAssumptions.length > 0) return this.reject("Baseline verification cannot pass with unresolved assumptions.");
		const resolved = this.resolveEvidence(input.evidence_refs);
		if (typeof resolved === "string") return this.reject(resolved);
		if (resolved.some((item) => item.mutationRevision !== 0)) {
			return this.reject("Baseline evidence must be collected before the first mutation (mutation revision 0).");
		}
		const taskText = `${this.latestUserPrompt}\n${this.state.taskSummary}`;
		if (input.baseline_method === "static_trace") {
			if (highRiskTask(taskText)) {
				return this.reject(
					"Static trace cannot satisfy baseline verification for signal/restart/persistence/recovery/concurrency/indexing work. Use runtime_reproduction or failing_regression_test.",
				);
			}
			const staticEvidence = resolved.filter(
				(item) => !item.isError && (STATIC_EVIDENCE_TOOL_NAMES.has(item.toolName) || item.toolName === "bash"),
			);
			if (staticEvidence.length < 2) {
				return this.reject("static_trace requires at least two independent non-error inspection evidence handles.");
			}
		}
		if (input.baseline_method === "runtime_reproduction" && !resolved.some((item) => item.toolName === "bash")) {
			return this.reject("runtime_reproduction requires bash evidence from an executed reproduction.");
		}
		if (
			input.baseline_method === "failing_regression_test" &&
			!resolved.some((item) => item.toolName === "bash" && item.isError)
		) {
			return this.reject("failing_regression_test requires a failing bash test result evidence handle.");
		}
		this.state = {
			...this.state,
			baseline: {
				required: this.state.baseline.required,
				status: "satisfied",
				hypothesis,
				conclusion,
				method: input.baseline_method,
				evidenceRefs: resolved.map((item) => item.ref),
				unresolvedAssumptions: [],
			},
			updatedAt: new Date().toISOString(),
		};
		this.persistState();
		return this.updated("Baseline verification recorded. Mutating tools are now unblocked.");
	}

	private recordFinal(input: TaskVerificationInput): TaskVerificationToolResult {
		if (!this.state.taskKind || !this.state.taskSummary) return this.reject("Declare the task before recording final verification.");
		if (this.state.mutationRevision === 0) return this.reject("Final verification requires at least one recorded mutation.");
		if (!isFinalMethod(input.final_method)) return this.reject("record_final requires final_method.");
		if (input.final_status !== "passed" && input.final_status !== "failed") {
			return this.reject("record_final requires final_status passed or failed.");
		}
		const expectedBehavior = normalizeText(input.expected_behavior);
		const observedBehavior = normalizeText(input.observed_behavior);
		if (!expectedBehavior || !observedBehavior) {
			return this.reject("record_final requires expected_behavior and observed_behavior.");
		}
		const unresolvedFailures = nonEmptyStrings(input.unresolved_failures);
		const resolved = this.resolveEvidence(input.evidence_refs);
		if (typeof resolved === "string") return this.reject(resolved);
		if (resolved.some((item) => item.mutationRevision !== this.state.mutationRevision)) {
			return this.reject(`Final evidence is stale. Every handle must come from mutation revision ${this.state.mutationRevision}.`);
		}
		if (input.final_status === "failed") {
			this.state = {
				...this.state,
				final: {
					status: "failed",
					expectedBehavior,
					observedBehavior,
					method: input.final_method,
					evidenceRefs: resolved.map((item) => item.ref),
					unresolvedFailures,
					verifiedMutationRevision: this.state.mutationRevision,
				},
				updatedAt: new Date().toISOString(),
			};
			this.persistState();
			return this.updated("Final verification recorded as failed. Successful completion remains blocked.");
		}
		if (unresolvedFailures.length > 0) return this.reject("Final verification cannot pass with unresolved failures.");
		if (resolved.some((item) => item.isError)) return this.reject("Passed final verification cannot cite failed evidence handles.");
		const taskText = `${this.latestUserPrompt}\n${this.state.taskSummary}`;
		const behavioral = requiresBehavioralFinalVerification(this.state.taskKind, taskText);
		if (input.final_method === "static_review") {
			if (behavioral) {
				return this.reject(
					"Static review cannot prove final behavior for code-changing work. Run a focused test, test suite, or manual reproduction.",
				);
			}
			if (resolved.filter((item) => STATIC_EVIDENCE_TOOL_NAMES.has(item.toolName)).length < 2) {
				return this.reject("static_review requires at least two non-error inspection evidence handles.");
			}
		}
		if (
			input.final_method === "focused_test" &&
			!resolved.some(
				(item) => item.toolName === "bash" && TEST_COMMAND_PATTERN.test(item.descriptor) && FOCUSED_TEST_PATTERN.test(item.descriptor),
			)
		) {
			return this.reject("focused_test requires bash evidence for a specific test file or test name.");
		}
		if (input.final_method === "test_suite") {
			if (behavioral || highRiskTask(taskText)) {
				return this.reject("A broad test suite alone is insufficient for this behavioral task. Use focused_test or manual_reproduction.");
			}
			if (!resolved.some((item) => item.toolName === "bash" && TEST_COMMAND_PATTERN.test(item.descriptor))) {
				return this.reject("test_suite requires bash evidence from a test-suite command.");
			}
		}
		if (
			input.final_method === "manual_reproduction" &&
			!resolved.some((item) => item.toolName === "bash" && !GENERIC_CHECK_PATTERN.test(item.descriptor))
		) {
			return this.reject("manual_reproduction requires non-generic bash evidence that exercises the changed behavior.");
		}
		this.state = {
			...this.state,
			final: {
				status: "passed",
				expectedBehavior,
				observedBehavior,
				method: input.final_method,
				evidenceRefs: resolved.map((item) => item.ref),
				unresolvedFailures: [],
				verifiedMutationRevision: this.state.mutationRevision,
			},
			updatedAt: new Date().toISOString(),
		};
		this.persistState();
		return this.updated("Final semantic verification passed for the current mutation revision.");
	}

	private resolveEvidence(refs: readonly string[] | undefined): TaskVerificationEvidence[] | string {
		const normalizedRefs = uniqueEvidenceRefs(nonEmptyStrings(refs));
		if (normalizedRefs.length === 0) return "At least one evidence_refs handle is required.";
		const missing = normalizedRefs.filter((ref) => !this.evidence.has(ref));
		if (missing.length > 0) return `Unknown verification evidence handle(s): ${missing.join(", ")}.`;
		return normalizedRefs.map((ref) => this.evidence.get(ref)!);
	}

	private getFinalGateReason(action: string): string | undefined {
		if (this.state.mutationRevision === 0) return undefined;
		if (this.state.baseline.required && this.state.baseline.status !== "satisfied") {
			return `Cannot ${action}: baseline verification is incomplete.`;
		}
		if (this.state.final.status !== "passed" || this.state.final.verifiedMutationRevision !== this.state.mutationRevision) {
			return (
				`Cannot ${action}: semantic verification has not passed after mutation revision ${this.state.mutationRevision}. ` +
				`Run behavior-specific verification and call ${TASK_VERIFICATION_TOOL_NAME} with action "record_final".`
			);
		}
		return undefined;
	}

	private formatStatus(): string {
		const recentEvidence = [...this.evidence.values()]
			.slice(-8)
			.map((item) => `${item.ref}: ${item.toolName} at revision ${item.mutationRevision}${item.isError ? " (failed)" : ""}`);
		return [
			`Task: ${this.state.taskKind ?? "undeclared"}${this.state.taskSummary ? ` — ${this.state.taskSummary}` : ""}`,
			`Mutation revision: ${this.state.mutationRevision}`,
			`Baseline: ${this.state.baseline.status}${this.state.baseline.required ? " (required)" : ""}`,
			`Final verification: ${this.state.final.status}${
				this.state.final.verifiedMutationRevision !== undefined
					? ` at revision ${this.state.final.verifiedMutationRevision}`
					: ""
			}`,
			recentEvidence.length > 0
				? `Recent evidence:\n${recentEvidence.map((item) => `- ${item}`).join("\n")}`
				: "Recent evidence: none",
		].join("\n");
	}

	private persistState(): void {
		this.sessionManager.appendCustomEntry(TASK_VERIFICATION_STATE_CUSTOM_TYPE, this.state);
	}

	private updated(message: string): TaskVerificationToolResult {
		return { status: "updated", message, state: this.currentState };
	}

	private reject(message: string): TaskVerificationToolResult {
		return { status: "rejected", message, state: this.currentState };
	}
}

export function createTaskVerificationController(sessionManager: SessionManager): TaskVerificationController {
	return new TaskVerificationController(sessionManager);
}
