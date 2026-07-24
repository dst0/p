import { isAbsolute, resolve } from "node:path";
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
import { captureWorkspaceFingerprint } from "./workspace-fingerprint.ts";

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
		authorizedTestPaths: string[];
		testSetupChanged: boolean;
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
		Type.Literal("authorize_baseline_test"),
		Type.Literal("record_baseline"),
		Type.Literal("record_final"),
		Type.Literal("status"),
	]),
	task_kind: Type.Optional(TaskKindSchema),
	task_summary: Type.Optional(Type.String()),
	test_paths: Type.Optional(Type.Array(Type.String(), { minItems: 1, maxItems: 8 })),
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
const DIRECT_MUTATION_TOOLS = new Set(["edit", "write"]);
const BUG_PATTERN = /\b(bug|fix|broken|regression|incorrect|wrong|failure|lost|crash|race|issue|repair)\b|(?:ошиб|баг|слом|невер|неправ|теря|паден|исправ)/iu;
const HIGH_RISK_PATTERN = /\b(sigterm|sigint|sigkill|signal|shutdown|restart|daemon|crash|recovery|resume|checkpoint|manifest|persist|durab|transaction|concurr|race|deadlock|indexing|refresh|migration)\b|(?:сигнал|завершен|перезапуск|демон|восстанов|чекпоинт|манифест|персист|транзакц|конкурент|гонк|индекс|миграц)/iu;
const BASH_MUTATION_PATTERN = /(?:^|[;&|]\s*)(?:sed\s+-i|perl\s+-[a-z]*i|patch\b|git\s+(?:apply|am|cherry-pick|merge|rebase|checkout|switch|reset|restore)\b|rm\b|mv\b|cp\b|touch\b|mkdir\b|truncate\b|tee\b|npm\s+(?:install|uninstall|update)\b|pnpm\s+(?:add|remove|install|update)\b|yarn\s+(?:add|remove|install|upgrade)\b|bun\s+(?:add|remove|install|update)\b|cargo\s+(?:add|remove|update)\b|node\s+scripts\/version-bump\.mjs\b|\.\/reinstall\.sh\b)/iu;
const WRITE_REDIRECT_PATTERN = /(?:^|[;&|]\s*)(?:echo|printf|cat)\b[^\n;]*(?:>|>>)\s*(?!\/dev\/null\b)/iu;
const PUBLISH_PATTERN = /(?:^|[;&|]\s*)git\s+(?:commit|push)\b/iu;
const GENERIC_CHECK_PATTERN = /^\s*(?:npm\s+run\s+check|pnpm\s+run\s+check|yarn\s+check|tsc\b|biome\b|eslint\b|prettier\b|cargo\s+(?:fmt|clippy)\b)/iu;
const READ_ONLY_PATTERN = /^\s*(?:pwd\b|ls\b|find\b|fd\b|rg\b|grep\b|cat\b|head\b|tail\b|git\s+(?:status|diff|show|log)\b)/iu;
const TEST_PATTERN = /\b(?:vitest|jest|pytest|cargo\s+test|go\s+test|bun\s+test|npm\s+test|pnpm\s+test|yarn\s+test|\.\/test\.sh)\b/iu;
const FOCUSED_TEST_PATTERN = /(?:test\/|tests\/|\.test\.[cm]?[jt]sx?|\.spec\.[cm]?[jt]sx?|--test-name-pattern\b|\s-t\s+\S+)/iu;
const TEST_PATH_PATTERN = /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|\.(?:test|spec)\.[^/]+$/iu;

function emptyState(): TaskVerificationState {
	return {
		version: 1,
		mutationRevision: 0,
		baseline: {
			required: false,
			status: "not_required",
			evidenceRefs: [],
			authorizedTestPaths: [],
			testSetupChanged: false,
		},
		final: { status: "pending", evidenceRefs: [], unresolvedFailures: [] },
		updatedAt: new Date().toISOString(),
	};
}

function normalizeText(value: string | undefined): string {
	return value?.replace(/\s+/g, " ").trim() ?? "";
}

function normalizeStrings(values: readonly string[] | undefined): string[] {
	return [...new Set((values ?? []).map(normalizeText).filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTaskKind(value: unknown): value is TaskKind {
	return typeof value === "string" && (TASK_KINDS as readonly string[]).includes(value);
}

function isBaselineMethod(value: unknown): value is BaselineMethod {
	return typeof value === "string" && (BASELINE_METHODS as readonly string[]).includes(value);
}

function isFinalMethod(value: unknown): value is FinalMethod {
	return typeof value === "string" && (FINAL_METHODS as readonly string[]).includes(value);
}

function isTaskVerificationState(value: unknown): value is TaskVerificationState {
	return (
		isRecord(value) &&
		value.version === 1 &&
		typeof value.mutationRevision === "number" &&
		isRecord(value.baseline) &&
		Array.isArray(value.baseline.authorizedTestPaths) &&
		typeof value.baseline.testSetupChanged === "boolean" &&
		isRecord(value.final)
	);
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

function argsRecord(args: unknown): Record<string, unknown> {
	return isRecord(args) ? args : {};
}

function bashCommand(args: unknown): string {
	const value = argsRecord(args).command;
	return typeof value === "string" ? value.trim() : "";
}

function isPublishCommand(toolName: string, args: unknown): boolean {
	return toolName === "bash" && PUBLISH_PATTERN.test(bashCommand(args));
}

function isRecognizedBashMutation(args: unknown): boolean {
	const command = bashCommand(args);
	return BASH_MUTATION_PATTERN.test(command) || WRITE_REDIRECT_PATTERN.test(command);
}

function isPotentialMutationTool(toolName: string, args: unknown): boolean {
	return DIRECT_MUTATION_TOOLS.has(toolName) || (toolName === "bash" && !isPublishCommand(toolName, args));
}

function pathArgument(args: unknown): string | undefined {
	const value = argsRecord(args).path;
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function describeToolCall(toolName: string, args: unknown): string {
	if (toolName === "bash") return bashCommand(args) || "bash";
	const values = argsRecord(args);
	const detail = typeof values.path === "string" ? values.path : typeof values.query === "string" ? values.query : "";
	return detail ? `${toolName} ${detail}` : toolName;
}

function summarizeOutput(content: AfterToolCallContext["result"]["content"]): string {
	const value = content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();
	return value.length <= 500 ? value : `${value.slice(0, 499).trimEnd()}…`;
}

function baselineRequired(kind: TaskKind, taskText: string): boolean {
	return kind === "bug_fix" || kind === "behavior_change" || kind === "refactor" || BUG_PATTERN.test(taskText);
}

function behavioralFinalRequired(kind: TaskKind, taskText: string): boolean {
	return kind !== "docs" && kind !== "investigation" && (kind !== "feature" || BUG_PATTERN.test(taskText));
}

export class TaskVerificationController {
	readonly toolDefinition: ToolDefinition;
	private readonly sessionManager: SessionManager;
	private readonly evidence = new Map<string, TaskVerificationEvidence>();
	private readonly bashFingerprints = new Map<string, string | undefined>();
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
		const previousBeforeToolCall = agent.beforeToolCall;
		const previousAfterToolCall = agent.afterToolCall;

		agent.beforeToolCall = async (context, signal) => {
			const verificationGate = this.beforeToolCall(context);
			if (verificationGate?.block) return verificationGate;
			const previousResult = await previousBeforeToolCall?.(context, signal);
			if (previousResult?.block) return previousResult;
			if (context.toolCall.name === "bash" && !isPublishCommand(context.toolCall.name, context.args)) {
				this.bashFingerprints.set(
					context.toolCall.id,
					await captureWorkspaceFingerprint(this.sessionManager.getCwd()),
				);
			}
			return previousResult;
		};

		agent.afterToolCall = async (context, signal) => {
			const previousResult = await previousAfterToolCall?.(context, signal);
			return this.afterToolCall(context, previousResult);
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
			promptSnippet:
				"record_task_verification(action, ...): declare mutation intent, optionally authorize test-only baseline setup, then prove baseline and final behavior.",
			promptGuidelines: [
				`Before edit, write, or mutating bash, call ${TASK_VERIFICATION_TOOL_NAME} with action \"declare_task\".`,
				"Bug fixes, behavior changes, and refactors require evidence-backed baseline verification before production mutation.",
				"To create a failing regression test before implementation, authorize exact test paths with action \"authorize_baseline_test\"; only those test files may be edited until the failing focused test is recorded.",
				"Signal, restart, persistence, recovery, transaction, concurrency, migration, and indexing tasks require runtime reproduction or a failing focused regression test.",
				"Final verification must rerun the same reproduction command or focused regression test that established the baseline.",
				"After the last production mutation, record fresh behavior-specific verification. Generic check/lint output is not semantic proof.",
				"Successful finish_work and git commit/push are blocked until final verification passes for the current mutation revision.",
			],
			parameters: VerificationSchema,
			executionMode: "sequential",
			execute: async (_id, params) => {
				const result = this.applyInput(params);
				if (result.status === "rejected") throw new Error(result.message);
				return { content: [{ type: "text", text: result.message }], details: result };
			},
		};
	}

	private beforeToolCall(context: BeforeToolCallContext): BeforeToolCallResult | undefined {
		const toolName = context.toolCall.name;
		if (isPublishCommand(toolName, context.args)) return this.finalGate("publish changes");
		if (
			toolName === "finish_work" &&
			argsRecord(context.args).status !== "partial" &&
			argsRecord(context.args).status !== "failed"
		) {
			return this.finalGate("finish successfully");
		}
		if (!isPotentialMutationTool(toolName, context.args)) return undefined;
		if (!this.state.taskKind) {
			return {
				block: true,
				reason: `Call ${TASK_VERIFICATION_TOOL_NAME} with action \"declare_task\" before mutating code.`,
			};
		}
		if (this.state.baseline.required && this.state.baseline.status !== "satisfied") {
			if (toolName === "bash") return undefined;
			if (this.isAuthorizedBaselineTestMutation(toolName, context.args)) return undefined;
			return {
				block: true,
				reason: "Collect baseline evidence or authorize exact regression-test paths before implementation.",
			};
		}
		return undefined;
	}

	private async afterToolCall(
		context: AfterToolCallContext,
		previousResult: AfterToolCallResult | undefined,
	): Promise<AfterToolCallResult | undefined> {
		const effectiveIsError = previousResult?.isError ?? context.isError;
		const mutationDetected = await this.detectMutation(context, effectiveIsError);
		if (mutationDetected) {
			if (this.isAuthorizedBaselineTestMutation(context.toolCall.name, context.args)) {
				this.state = {
					...this.state,
					baseline: { ...this.state.baseline, testSetupChanged: true },
					updatedAt: new Date().toISOString(),
				};
				this.persistState();
				return previousResult;
			}
			this.state = {
				...this.state,
				mutationRevision: this.state.mutationRevision + 1,
				final: { status: "pending", evidenceRefs: [], unresolvedFailures: [] },
				updatedAt: new Date().toISOString(),
			};
			this.persistState();
			return previousResult;
		}

		if (!EVIDENCE_TOOLS.has(context.toolCall.name)) return previousResult;
		const content = previousResult?.content ?? context.result.content;
		const evidence: TaskVerificationEvidence = {
			version: 1,
			ref: `verification-evidence-${this.nextEvidence++}`,
			toolCallId: context.toolCall.id,
			toolName: context.toolCall.name,
			descriptor: describeToolCall(context.toolCall.name, context.args),
			outputSummary: summarizeOutput(content),
			isError: effectiveIsError,
			mutationRevision: this.state.mutationRevision,
			timestamp: new Date().toISOString(),
		};
		this.evidence.set(evidence.ref, evidence);
		this.sessionManager.appendCustomEntry(TASK_VERIFICATION_EVIDENCE_CUSTOM_TYPE, evidence);

		const result: AfterToolCallResult = {
			content: [
				...content,
				{
					type: "text",
					text: `Verification evidence handle: ${evidence.ref} (${evidence.toolName}, mutation revision ${evidence.mutationRevision}).`,
				},
			],
			isError: effectiveIsError,
		};
		if (previousResult?.details !== undefined) result.details = previousResult.details;
		else if (context.result.details !== undefined) result.details = context.result.details;
		if (previousResult?.terminate !== undefined) result.terminate = previousResult.terminate;
		return result;
	}

	private async detectMutation(context: AfterToolCallContext, isError: boolean): Promise<boolean> {
		const toolName = context.toolCall.name;
		if (DIRECT_MUTATION_TOOLS.has(toolName)) return !isError;
		if (toolName !== "bash" || isPublishCommand(toolName, context.args)) return false;

		const hadFingerprint = this.bashFingerprints.has(context.toolCall.id);
		const beforeFingerprint = this.bashFingerprints.get(context.toolCall.id);
		this.bashFingerprints.delete(context.toolCall.id);
		if (hadFingerprint && beforeFingerprint !== undefined) {
			const afterFingerprint = await captureWorkspaceFingerprint(this.sessionManager.getCwd());
			if (afterFingerprint !== undefined) return beforeFingerprint !== afterFingerprint;
		}
		return isRecognizedBashMutation(context.args);
	}

	private applyInput(input: VerificationInput): VerificationResult {
		switch (input.action) {
			case "declare_task":
				return this.declareTask(input);
			case "authorize_baseline_test":
				return this.authorizeBaselineTest(input);
			case "record_baseline":
				return this.recordBaseline(input);
			case "record_final":
				return this.recordFinal(input);
			case "status":
				return this.updated(this.formatStatus());
		}
	}

	private declareTask(input: VerificationInput): VerificationResult {
		if (!isTaskKind(input.task_kind) || !normalizeText(input.task_summary)) {
			return this.rejected("declare_task requires task_kind and a concrete task_summary.");
		}
		if (this.state.mutationRevision > 0) {
			return this.rejected("Cannot replace the task declaration after mutation; finish the current task first.");
		}
		const taskSummary = normalizeText(input.task_summary);
		const required = baselineRequired(input.task_kind, `${this.latestUserPrompt}\n${taskSummary}`);
		this.state = {
			...emptyState(),
			taskKind: input.task_kind,
			taskSummary,
			baseline: {
				required,
				status: required ? "pending" : "not_required",
				evidenceRefs: [],
				authorizedTestPaths: [],
				testSetupChanged: false,
			},
			updatedAt: new Date().toISOString(),
		};
		this.persistState();
		return this.updated(
			required
				? "Task declared; baseline verification is required before production mutation."
				: "Task declared; final verification is required after mutation.",
		);
	}

	private authorizeBaselineTest(input: VerificationInput): VerificationResult {
		if (!this.state.taskKind || !this.state.baseline.required || this.state.baseline.status !== "pending") {
			return this.rejected("Test-only baseline authorization requires a declared task with pending baseline verification.");
		}
		if (this.state.mutationRevision !== 0) {
			return this.rejected("Cannot authorize baseline test edits after production mutation.");
		}
		const requestedPaths = normalizeStrings(input.test_paths);
		if (requestedPaths.length === 0) return this.rejected("authorize_baseline_test requires test_paths.");

		const normalizedPaths: string[] = [];
		for (const filePath of requestedPaths) {
			const portablePath = filePath.replaceAll("\\", "/").replace(/^\.\//u, "");
			if (isAbsolute(filePath) || portablePath.split("/").includes("..") || !TEST_PATH_PATTERN.test(portablePath)) {
				return this.rejected(`Only explicit repository-relative test files may be authorized: ${filePath}`);
			}
			normalizedPaths.push(portablePath);
		}
		this.state = {
			...this.state,
			baseline: {
				...this.state.baseline,
				authorizedTestPaths: [...new Set(normalizedPaths)],
				testSetupChanged: false,
			},
			updatedAt: new Date().toISOString(),
		};
		this.persistState();
		return this.updated(`Authorized test-only baseline setup for: ${this.state.baseline.authorizedTestPaths.join(", ")}`);
	}

	private recordBaseline(input: VerificationInput): VerificationResult {
		if (!this.state.taskKind || !this.state.taskSummary) {
			return this.rejected("Declare the task before baseline verification.");
		}
		if (!isBaselineMethod(input.baseline_method) || !normalizeText(input.hypothesis) || !normalizeText(input.conclusion)) {
			return this.rejected("record_baseline requires baseline_method, hypothesis, and conclusion.");
		}
		if (normalizeStrings(input.unresolved_assumptions).length > 0) {
			return this.rejected("Baseline verification cannot pass with unresolved assumptions.");
		}
		const evidence = this.resolveEvidence(input.evidence_refs);
		if (typeof evidence === "string") return this.rejected(evidence);
		if (evidence.some((item) => item.mutationRevision !== 0)) {
			return this.rejected("Baseline evidence must come from mutation revision 0.");
		}

		const taskText = `${this.latestUserPrompt}\n${this.state.taskSummary}`;
		if (input.baseline_method === "static_trace") {
			if (HIGH_RISK_PATTERN.test(taskText)) {
				return this.rejected("Static trace is insufficient for signal/restart/persistence/recovery/concurrency/indexing work.");
			}
			if (evidence.filter((item) => !item.isError && STATIC_TOOLS.has(item.toolName)).length < 2) {
				return this.rejected("static_trace requires two non-error inspection evidence handles.");
			}
		}
		if (
			input.baseline_method === "runtime_reproduction" &&
			!evidence.some(
				(item) =>
					item.toolName === "bash" &&
					!item.isError &&
					!GENERIC_CHECK_PATTERN.test(item.descriptor) &&
					!READ_ONLY_PATTERN.test(item.descriptor),
			)
		) {
			return this.rejected("runtime_reproduction requires successful non-generic bash evidence exercising the behavior.");
		}
		if (input.baseline_method === "failing_regression_test") {
			if (this.state.baseline.authorizedTestPaths.length > 0 && !this.state.baseline.testSetupChanged) {
				return this.rejected("The authorized regression test was not created or modified before running it.");
			}
			if (
				!evidence.some(
					(item) =>
						item.toolName === "bash" &&
						item.isError &&
						TEST_PATTERN.test(item.descriptor) &&
						FOCUSED_TEST_PATTERN.test(item.descriptor),
				)
			) {
				return this.rejected("failing_regression_test requires a failing focused-test evidence handle.");
			}
		}

		this.state = {
			...this.state,
			baseline: {
				...this.state.baseline,
				status: "satisfied",
				hypothesis: normalizeText(input.hypothesis),
				conclusion: normalizeText(input.conclusion),
				method: input.baseline_method,
				evidenceRefs: evidence.map((item) => item.ref),
			},
			updatedAt: new Date().toISOString(),
		};
		this.persistState();
		return this.updated("Baseline verification recorded; production mutation is unblocked.");
	}

	private recordFinal(input: VerificationInput): VerificationResult {
		if (!this.state.taskKind || !this.state.taskSummary || this.state.mutationRevision === 0) {
			return this.rejected("Final verification requires a declared task and at least one production mutation.");
		}
		if (!isFinalMethod(input.final_method) || (input.final_status !== "passed" && input.final_status !== "failed")) {
			return this.rejected("record_final requires final_method and final_status.");
		}
		const expectedBehavior = normalizeText(input.expected_behavior);
		const observedBehavior = normalizeText(input.observed_behavior);
		if (!expectedBehavior || !observedBehavior) {
			return this.rejected("record_final requires expected_behavior and observed_behavior.");
		}
		const unresolvedFailures = normalizeStrings(input.unresolved_failures);
		const evidence = this.resolveEvidence(input.evidence_refs);
		if (typeof evidence === "string") return this.rejected(evidence);
		if (evidence.some((item) => item.mutationRevision !== this.state.mutationRevision)) {
			return this.rejected(
				`Final evidence is stale; all handles must come from mutation revision ${this.state.mutationRevision}.`,
			);
		}

		if (input.final_status === "failed") {
			this.state = {
				...this.state,
				final: {
					status: "failed",
					expectedBehavior,
					observedBehavior,
					method: input.final_method,
					evidenceRefs: evidence.map((item) => item.ref),
					unresolvedFailures,
					verifiedMutationRevision: this.state.mutationRevision,
				},
				updatedAt: new Date().toISOString(),
			};
			this.persistState();
			return this.updated("Final verification recorded as failed; successful completion remains blocked.");
		}
		if (unresolvedFailures.length > 0 || evidence.some((item) => item.isError)) {
			return this.rejected("Passed final verification cannot contain unresolved failures or failed evidence.");
		}

		const taskText = `${this.latestUserPrompt}\n${this.state.taskSummary}`;
		const behavioral = behavioralFinalRequired(this.state.taskKind, taskText);
		if (
			input.final_method === "static_review" &&
			(behavioral || evidence.filter((item) => STATIC_TOOLS.has(item.toolName)).length < 2)
		) {
			return this.rejected("static_review cannot prove behavioral code changes and otherwise requires two inspection handles.");
		}
		if (
			input.final_method === "focused_test" &&
			!evidence.some(
				(item) => item.toolName === "bash" && TEST_PATTERN.test(item.descriptor) && FOCUSED_TEST_PATTERN.test(item.descriptor),
			)
		) {
			return this.rejected("focused_test requires evidence from a specific test file or test name.");
		}
		if (
			input.final_method === "test_suite" &&
			(behavioral ||
				HIGH_RISK_PATTERN.test(taskText) ||
				!evidence.some((item) => item.toolName === "bash" && TEST_PATTERN.test(item.descriptor)))
		) {
			return this.rejected("A broad test suite alone is insufficient for this behavioral task.");
		}
		if (
			input.final_method === "manual_reproduction" &&
			!evidence.some(
				(item) =>
					item.toolName === "bash" &&
					!GENERIC_CHECK_PATTERN.test(item.descriptor) &&
					!READ_ONLY_PATTERN.test(item.descriptor),
			)
		) {
			return this.rejected("manual_reproduction requires non-generic bash evidence exercising the changed behavior.");
		}

		const baselineEvidence = this.state.baseline.evidenceRefs
			.map((ref) => this.evidence.get(ref))
			.filter((item): item is TaskVerificationEvidence => item !== undefined);
		if (this.state.baseline.method === "runtime_reproduction") {
			const baselineCommands = new Set(
				baselineEvidence.filter((item) => item.toolName === "bash" && !item.isError).map((item) => item.descriptor),
			);
			if (!evidence.some((item) => item.toolName === "bash" && baselineCommands.has(item.descriptor))) {
				return this.rejected("Final verification must rerun the same command that established the runtime baseline.");
			}
		}
		if (this.state.baseline.method === "failing_regression_test") {
			const baselineTests = new Set(
				baselineEvidence
					.filter((item) => item.toolName === "bash" && item.isError && TEST_PATTERN.test(item.descriptor))
					.map((item) => item.descriptor),
			);
			if (!evidence.some((item) => item.toolName === "bash" && baselineTests.has(item.descriptor))) {
				return this.rejected("Final verification must rerun the same focused test that failed at baseline.");
			}
		}

		this.state = {
			...this.state,
			final: {
				status: "passed",
				expectedBehavior,
				observedBehavior,
				method: input.final_method,
				evidenceRefs: evidence.map((item) => item.ref),
				unresolvedFailures: [],
				verifiedMutationRevision: this.state.mutationRevision,
			},
			updatedAt: new Date().toISOString(),
		};
		this.persistState();
		return this.updated("Final semantic verification passed for the current mutation revision.");
	}

	private isAuthorizedBaselineTestMutation(toolName: string, args: unknown): boolean {
		if (
			this.state.baseline.status !== "pending" ||
			this.state.baseline.authorizedTestPaths.length === 0 ||
			!DIRECT_MUTATION_TOOLS.has(toolName)
		) {
			return false;
		}
		const filePath = pathArgument(args);
		if (!filePath) return false;
		const absolutePath = resolve(this.sessionManager.getCwd(), filePath);
		return this.state.baseline.authorizedTestPaths.some(
			(authorizedPath) => resolve(this.sessionManager.getCwd(), authorizedPath) === absolutePath,
		);
	}

	private resolveEvidence(refs: readonly string[] | undefined): TaskVerificationEvidence[] | string {
		const normalizedRefs = normalizeStrings(refs);
		if (normalizedRefs.length === 0) return "At least one evidence_refs handle is required.";
		const missingRefs = normalizedRefs.filter((ref) => !this.evidence.has(ref));
		if (missingRefs.length > 0) return `Unknown evidence handle(s): ${missingRefs.join(", ")}.`;
		return normalizedRefs.map((ref) => this.evidence.get(ref)!);
	}

	private finalGate(action: string): BeforeToolCallResult | undefined {
		if (this.state.mutationRevision === 0) return undefined;
		if (this.state.baseline.required && this.state.baseline.status !== "satisfied") {
			return { block: true, reason: `Cannot ${action}: baseline verification is incomplete.` };
		}
		if (
			this.state.final.status !== "passed" ||
			this.state.final.verifiedMutationRevision !== this.state.mutationRevision
		) {
			return {
				block: true,
				reason: `Cannot ${action}: semantic verification has not passed after mutation revision ${this.state.mutationRevision}.`,
			};
		}
		return undefined;
	}

	private restore(): void {
		for (const entry of this.sessionManager.getBranch()) {
			if (entry.type !== "custom") continue;
			if (
				entry.customType === TASK_VERIFICATION_STATE_CUSTOM_TYPE &&
				isTaskVerificationState(entry.data)
			) {
				this.state = entry.data;
			}
			if (
				entry.customType === TASK_VERIFICATION_EVIDENCE_CUSTOM_TYPE &&
				isTaskVerificationEvidence(entry.data)
			) {
				this.evidence.set(entry.data.ref, entry.data);
				const numericRef = Number.parseInt(entry.data.ref.replace(/^verification-evidence-/, ""), 10);
				if (Number.isFinite(numericRef)) this.nextEvidence = Math.max(this.nextEvidence, numericRef + 1);
			}
		}
	}

	private persistState(): void {
		this.sessionManager.appendCustomEntry(TASK_VERIFICATION_STATE_CUSTOM_TYPE, this.state);
	}

	private formatStatus(): string {
		const recentEvidence = [...this.evidence.values()]
			.slice(-8)
			.map(
				(item) =>
					`${item.ref}: ${item.toolName} at revision ${item.mutationRevision}${item.isError ? " (failed)" : ""}`,
			);
		return [
			`Task: ${this.state.taskKind ?? "undeclared"}${this.state.taskSummary ? ` — ${this.state.taskSummary}` : ""}`,
			`Mutation revision: ${this.state.mutationRevision}`,
			`Baseline: ${this.state.baseline.status}`,
			`Authorized baseline tests: ${this.state.baseline.authorizedTestPaths.join(", ") || "none"}`,
			`Final: ${this.state.final.status}`,
			recentEvidence.length > 0
				? `Evidence:\n- ${recentEvidence.join("\n- ")}`
				: "Evidence: none",
		].join("\n");
	}

	private updated(message: string): VerificationResult {
		return { status: "updated", message, state: this.currentState };
	}

	private rejected(message: string): VerificationResult {
		return { status: "rejected", message, state: this.currentState };
	}
}

export function createTaskVerificationController(sessionManager: SessionManager): TaskVerificationController {
	return new TaskVerificationController(sessionManager);
}
