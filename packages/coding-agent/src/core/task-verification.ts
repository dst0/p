import { randomUUID } from "node:crypto";
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

export interface TaskVerificationAcceptanceCheck {
  criterion: string;
  evidenceRefs: string[];
}

export interface TaskVerificationState {
  version: 1;
  taskKind?: TaskKind;
  taskSummary?: string;
  /** Original user task context retained across compaction/session restore. */
  taskContext?: string;
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
  readiness?: {
    status: "pending" | "ready";
    token?: string;
    acceptanceChecks: TaskVerificationAcceptanceCheck[];
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
const AcceptanceCheckSchema = Type.Object({
  criterion: Type.String({ minLength: 1 }),
  evidence_refs: Type.Array(Type.String(), { minItems: 1, maxItems: 8 }),
});
const VerificationSchema = Type.Object({
  action: Type.Union([
    Type.Literal("declare_task"),
    Type.Literal("authorize_baseline_test"),
    Type.Literal("record_baseline"),
    Type.Literal("record_final"),
    Type.Literal("ready_to_finish"),
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
  acceptance_checks: Type.Optional(Type.Array(AcceptanceCheckSchema, { minItems: 1, maxItems: 32 })),
});
type VerificationInput = Static<typeof VerificationSchema>;
interface VerificationResult {
  status: "updated" | "needs_action";
  message: string;
  state: TaskVerificationState;
}

const KNOWN_EVIDENCE_TOOLS = new Set(["read", "bash", "rg", "grep", "find", "ls", "semantic_search"]);
const KNOWN_STATIC_TOOLS = new Set(["read", "rg", "grep", "find", "ls", "semantic_search"]);
const KNOWN_DIRECT_MUTATION_TOOLS = new Set(["edit", "write"]);
const BUG_PATTERN =
  /\b(bug|fix|broken|regression|incorrect|wrong|failure|lost|crash|race|issue|repair)\b|(?:ошиб|баг|слом|невер|неправ|теря|паден|исправ)/iu;
const REFACTOR_PATTERN = /\brefactor|restructure|reorganize\b|(?:рефактор|перестро|реорганиз)/iu;
const DOCS_PATTERN = /\b(?:docs?|documentation|readme|changelog)\b|(?:документ|ридми|чейнджлог)/iu;
const INVESTIGATION_PATTERN =
  /\b(?:investigat|diagnos|analy[sz]|audit|explain|find the cause)\b|(?:исслед|диагност|анализ|аудит|объясн|причин)/iu;
const HIGH_RISK_PATTERN =
  /\b(sigterm|sigint|sigkill|signal|shutdown|restart|daemon|crash|recovery|resume|checkpoint|manifest|persist|durab|transaction|concurr|race|deadlock|indexing|refresh|migration)\b|(?:сигнал|завершен|перезапуск|демон|восстанов|чекпоинт|манифест|персист|транзакц|конкурент|гонк|индекс|миграц)/iu;
const BASH_MUTATION_PATTERN =
  /(?:^|[;&|]\s*)(?:sed\s+-i|perl\s+-[a-z]*i|patch\b|git\s+(?:apply|am|cherry-pick|merge|rebase|checkout|switch|reset|restore)\b|rm\b|mv\b|cp\b|touch\b|mkdir\b|truncate\b|tee\b|npm\s+(?:install|uninstall|update)\b|pnpm\s+(?:add|remove|install|update)\b|yarn\s+(?:add|remove|install|upgrade)\b|bun\s+(?:add|remove|install|update)\b|cargo\s+(?:add|remove|update)\b|node\s+scripts\/version-bump\.js\b|\.\/reinstall\.sh\b)/iu;
const WRITE_REDIRECT_PATTERN = /(?:^|[;&|]\s*)(?:echo|printf|cat)\b[^\n;]*(?:>|>>)\s*(?!\/dev\/null\b)/iu;
const PUBLISH_PATTERN = /(?:^|[;&|]\s*)git\s+(?:commit|push)\b/iu;
const GENERIC_CHECK_PATTERN =
  /(?:^|[;&|]\s*)(?:npm\s+(?:run\s+)?(?:check|typecheck)|pnpm\s+(?:run\s+)?(?:check|typecheck)|yarn\s+(?:run\s+)?(?:check|typecheck)|(?:npx\s+|npm\s+exec\s+)?tsc\b|biome\b|eslint\b|prettier\b|cargo\s+(?:fmt|clippy)\b)/iu;
const TYPECHECK_PATTERN =
  /(?:^|[;&|]\s*)(?:npm\s+(?:run\s+)?typecheck|pnpm\s+(?:run\s+)?typecheck|yarn\s+(?:run\s+)?typecheck|(?:npx\s+|npm\s+exec\s+)?tsc\b)/iu;
const READ_ONLY_PATTERN =
  /^\s*(?:pwd\b|ls\b|find\b|fd\b|rg\b|grep\b|cat\b|head\b|tail\b|stat\b|wc\b|md5\b|md5sum\b|shasum\b|sha256sum\b|git\s+(?:status|diff|show|log)\b)/iu;
const TEST_PATTERN =
  /\b(?:vitest|jest|pytest|cargo\s+test|go\s+test|node\s+--test|bun\s+(?:run\s+)?test|npm\s+(?:run\s+)?test|pnpm\s+(?:run\s+)?test|yarn\s+(?:run\s+)?test|\.\/test\.sh)\b/iu;
const FOCUSED_TEST_PATTERN =
  /(?:test\/|tests\/|\.test\.[cm]?[jt]sx?|\.spec\.[cm]?[jt]sx?|--test-name-pattern\b|\s-t\s+\S+)/iu;
const TEST_PATH_PATTERN = /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|\.(?:test|spec)\.[^/]+$/iu;
const TEST_REQUEST_PATTERN =
  /\b(?:run|execute|add|write|include|pass|rerun)?\s*(?:the\s+)?(?:focused\s+|full\s+|unit\s+|integration\s+|regression\s+)?tests?\b|(?:запуст|добав|напис|прогон|покр)[^\n.]{0,30}\bтест/iu;
const TEST_OPT_OUT_PATTERN =
  /\b(?:do not|don't|dont|skip|avoid|without|no need to)\s+(?:run|add|write|execute)?\s*(?:the\s+)?tests?\b|(?:не\s+(?:запуска|добавля|пиши)|без)\w*[^\n.]{0,20}\bтест/iu;
const TYPECHECK_REQUEST_PATTERN =
  /\b(?:run|pass|rerun)?\s*(?:the\s+)?(?:typecheck|type-check|type check|tsc)\b|(?:проверк\w*\s+тип|тайпчек)/iu;
const TYPECHECK_OPT_OUT_PATTERN =
  /\b(?:do not|don't|dont|skip|avoid|without|no need to)[^\n.]{0,60}\b(?:typecheck|type-check|type check|tsc)\b|(?:не\s+запуска\w*|без)[^\n.]{0,40}(?:проверк\w*\s+тип|тайпчек)/iu;
const ACCEPTANCE_SIGNAL_PATTERN =
  /\b(?:exact\w*|every|all|must|never|reject\w*|atomic\w*|rollback\w*|idempoten\w*|truncat\w*|tamper\w*|deep\w*|reverse\w*|monotonic\w*|stale|fenc\w*|persist\w*|recover\w*)\b|(?:точн\w*|кажд\w*|все|весь|долж\w*|никогд\w*|отклон\w*|атомар\w*|откат\w*|идемпотент\w*|обрез\w*|подмен\w*|глубок\w*|обратн\w*|монотон\w*|устар\w*|персист\w*|восстанов\w*)/giu;

function isShellTool(toolName: string): boolean {
  return (
    toolName === "bash" ||
    toolName === "ctx_shell" ||
    toolName === "run_command" ||
    toolName === "exec" ||
    toolName === "shell" ||
    toolName === "terminal" ||
    toolName.endsWith("_shell")
  );
}

function isEvidenceTool(toolName: string): boolean {
  if (KNOWN_EVIDENCE_TOOLS.has(toolName) || isShellTool(toolName)) return true;
  const lower = toolName.toLowerCase();
  return (
    lower.includes("read") ||
    lower.includes("grep") ||
    lower.includes("search") ||
    lower.includes("view") ||
    lower.includes("list") ||
    lower.includes("glob")
  );
}

function isStaticTool(toolName: string): boolean {
  if (KNOWN_STATIC_TOOLS.has(toolName)) return true;
  if (isShellTool(toolName)) return false;
  const lower = toolName.toLowerCase();
  return (
    lower.includes("read") ||
    lower.includes("grep") ||
    lower.includes("search") ||
    lower.includes("view") ||
    lower.includes("list") ||
    lower.includes("glob")
  );
}

function isDirectMutationTool(toolName: string): boolean {
  if (KNOWN_DIRECT_MUTATION_TOOLS.has(toolName)) return true;
  const lower = toolName.toLowerCase();
  return lower.includes("edit") || lower.includes("write") || lower.includes("patch") || lower.includes("replace");
}

function emptyReadiness(): NonNullable<TaskVerificationState["readiness"]> {
  return {
    status: "pending",
    acceptanceChecks: [],
  };
}

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
    readiness: emptyReadiness(),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeText(value: string | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function normalizeStrings(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map(normalizeText).filter(Boolean))];
}

function inferTaskKind(taskText: string): TaskKind {
  if (BUG_PATTERN.test(taskText)) return "bug_fix";
  if (REFACTOR_PATTERN.test(taskText)) return "refactor";
  if (DOCS_PATTERN.test(taskText)) return "docs";
  if (INVESTIGATION_PATTERN.test(taskText)) return "investigation";
  return "feature";
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

function shellCommand(args: unknown): string {
  const rec = argsRecord(args);
  const value = rec.command ?? rec.cmd ?? rec.script ?? rec.code ?? rec.CommandLine;
  return typeof value === "string" ? value.trim() : "";
}

function isPublishCommand(toolName: string, args: unknown): boolean {
  return isShellTool(toolName) && PUBLISH_PATTERN.test(shellCommand(args));
}

function isRecognizedBashMutation(args: unknown): boolean {
  const command = shellCommand(args);
  return BASH_MUTATION_PATTERN.test(command) || WRITE_REDIRECT_PATTERN.test(command);
}

function isPotentialMutationTool(toolName: string, args: unknown): boolean {
  if (isDirectMutationTool(toolName)) return true;
  if (isShellTool(toolName) && !isPublishCommand(toolName, args)) {
    return isRecognizedBashMutation(args);
  }
  return false;
}

function pathArgument(args: unknown): string | undefined {
  const rec = argsRecord(args);
  const value =
    rec.path ?? rec.TargetFile ?? rec.targetFile ?? rec.target_file ?? rec.filePath ?? rec.file ?? rec.TargetDirectory;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function describeToolCall(toolName: string, args: unknown): string {
  if (isShellTool(toolName)) return shellCommand(args) || toolName;
  const values = argsRecord(args);
  const detail = pathArgument(args) ?? (typeof values.query === "string" ? values.query : "");
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

function isCodeTask(kind: TaskKind | undefined): boolean {
  return kind !== undefined && kind !== "docs" && kind !== "investigation";
}

function requiredAcceptanceCheckCount(taskText: string): number {
  const signals = taskText.match(ACCEPTANCE_SIGNAL_PATTERN) ?? [];
  const uniqueSignals = new Set(signals.map((signal) => signal.toLowerCase()));
  return Math.max(1, Math.min(4, uniqueSignals.size));
}

function testsRequested(taskText: string): boolean {
  return TEST_REQUEST_PATTERN.test(taskText) && !TEST_OPT_OUT_PATTERN.test(taskText);
}

function typecheckRequested(taskText: string): boolean {
  return TYPECHECK_REQUEST_PATTERN.test(taskText) && !TYPECHECK_OPT_OUT_PATTERN.test(taskText);
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
      if (isShellTool(context.toolCall.name) && !isPublishCommand(context.toolCall.name, context.args)) {
        this.bashFingerprints.set(context.toolCall.id, await captureWorkspaceFingerprint(this.sessionManager.getCwd()));
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
      description:
        'Record or inspect evidence-backed baseline, final semantic verification, and finish readiness for mutating tasks. Use action "status" whenever the required next step is unclear, especially after compaction or session restore.',
      promptSnippet:
        "record_task_verification(action, ...): declare mutation intent, prove baseline and final behavior, then call ready_to_finish with requirement-to-evidence mappings before successful finish_work.",
      promptGuidelines: [
        `Call ${TASK_VERIFICATION_TOOL_NAME} with action "status" at any time to recover the exact current requirement, eligible evidence handles, and next tool-call shape. Do this after compaction or whenever a gate is unclear.`,
        `The controller automatically records mutation intent before the first mutating tool call. Use ${TASK_VERIFICATION_TOOL_NAME} with action "declare_task" only to override its classification before mutation.`,
        "Workflow steps: 1. collect the required baseline -> 2. apply file edits -> 3. rerun the exact baseline command. A successful exact replay automatically records final verification.",
        'When using static_trace for record_baseline, you MUST provide at least two non-error inspection evidence handles (e.g. evidence_refs: ["verification-evidence-1", "verification-evidence-2"]).',
        "Bug fixes, behavior changes, and refactors require evidence-backed baseline verification before production mutation.",
        'To create a failing regression test before implementation, authorize exact test paths with action "authorize_baseline_test"; only those test files may be edited until the failing focused test is recorded.',
        "Signal, restart, persistence, recovery, transaction, concurrency, migration, and indexing tasks require runtime reproduction or a failing focused regression test.",
        "Final verification must rerun the exact same reproduction command or focused regression test that established the baseline. Do not substitute static_review or generic npm run check.",
        "Evidence handles from prior mutation revisions become stale after any file edit. Re-run your verification command after editing to produce fresh handles for the current revision.",
        "When no exact baseline replay exists, record_final may omit evidence_refs and descriptive fields; the controller selects the latest eligible current-revision evidence and derives the method and observations.",
        "After final verification passes, call action 'ready_to_finish' with one acceptance_checks entry for every explicit requirement and fresh evidence_refs proving it.",
        "Successful finish_work and git commit/push are blocked until ready_to_finish issues a readiness certificate for the current mutation revision.",
      ],
      parameters: VerificationSchema,
      executionMode: "sequential",
      execute: async (_id, params) => {
        const result = this.applyInput(params);
        const message = result.status === "needs_action" ? this.withGuidance(result.message) : result.message;
        return { content: [{ type: "text", text: message }], details: result };
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
      const token = argsRecord(context.args).verification_token;
      return this.finalGate("finish successfully", typeof token === "string" ? token : undefined, true);
    }
    if (!isPotentialMutationTool(toolName, context.args)) return undefined;
    if (!this.state.taskKind) {
      const taskSummary =
        normalizeText(this.latestUserPrompt).slice(0, 500) || "Implement the requested workspace change.";
      this.declareTask({
        action: "declare_task",
        task_kind: inferTaskKind(taskSummary),
        task_summary: taskSummary,
      });
    }
    if (this.state.baseline.required && this.state.baseline.status !== "satisfied") {
      if (isShellTool(toolName)) return undefined;
      if (this.isAuthorizedBaselineTestMutation(toolName, context.args)) return undefined;
      return this.blocked("Collect baseline evidence or authorize exact regression-test paths before implementation.");
    }
    return undefined;
  }

  private async afterToolCall(
    context: AfterToolCallContext,
    previousResult: AfterToolCallResult | undefined,
  ): Promise<AfterToolCallResult | undefined> {
    const effectiveIsError = previousResult?.isError ?? context.isError;
    const content = previousResult?.content ?? context.result.content;
    const descriptor = describeToolCall(context.toolCall.name, context.args);

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
        readiness: emptyReadiness(),
        updatedAt: new Date().toISOString(),
      };
      this.persistState();
      return previousResult;
    }

    if (!isEvidenceTool(context.toolCall.name)) return previousResult;
    const evidence: TaskVerificationEvidence = {
      version: 1,
      ref: `verification-evidence-${this.nextEvidence++}`,
      toolCallId: context.toolCall.id,
      toolName: context.toolCall.name,
      descriptor,
      outputSummary: summarizeOutput(content),
      isError: effectiveIsError,
      mutationRevision: this.state.mutationRevision,
      timestamp: new Date().toISOString(),
    };
    this.evidence.set(evidence.ref, evidence);
    this.sessionManager.appendCustomEntry(TASK_VERIFICATION_EVIDENCE_CUSTOM_TYPE, evidence);
    const autoFinalized = this.tryAutoFinalizeExactReplay(evidence) ?? this.tryAutoFinalizeFocusedTest(evidence);
    const acceptanceAudit = autoFinalized ? undefined : this.highRiskAcceptanceAudit(evidence);

    const evidenceText = [
      `Verification evidence handle: ${evidence.ref} (@${evidence.toolCallId}, ${evidence.toolName}, mutation revision ${evidence.mutationRevision}).`,
      autoFinalized,
      acceptanceAudit,
    ]
      .filter((text): text is string => text !== undefined)
      .join("\n");
    const newContent = [...content];
    let lastIndex = -1;
    for (let i = newContent.length - 1; i >= 0; i--) {
      if (newContent[i]!.type === "text") {
        lastIndex = i;
        break;
      }
    }
    if (lastIndex !== -1) {
      const lastItem = newContent[lastIndex]!;
      if (lastItem.type === "text") {
        const text = lastItem.text ?? "";
        const footerMatch = text.match(/\n\n\[Showing lines [^\]]+\]$/);
        if (footerMatch && footerMatch.index !== undefined) {
          const head = text.slice(0, footerMatch.index);
          const footer = text.slice(footerMatch.index);
          newContent[lastIndex] = {
            type: "text",
            text: `${head}\n${evidenceText}${footer}`,
          };
        } else {
          newContent.push({ type: "text", text: evidenceText });
        }
      } else {
        newContent.push({ type: "text", text: evidenceText });
      }
    } else {
      newContent.push({ type: "text", text: evidenceText });
    }

    const result: AfterToolCallResult = {
      content: newContent,
      isError: effectiveIsError,
    };
    if (previousResult?.details !== undefined) result.details = previousResult.details;
    else if (context.result.details !== undefined) result.details = context.result.details;
    if (previousResult?.terminate !== undefined) result.terminate = previousResult.terminate;
    return result;
  }

  private async detectMutation(context: AfterToolCallContext, isError: boolean): Promise<boolean> {
    const toolName = context.toolCall.name;
    if (isDirectMutationTool(toolName)) return !isError;
    if (!isShellTool(toolName) || isPublishCommand(toolName, context.args)) return false;

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
      case "ready_to_finish":
        return this.readyToFinish(input);
      case "status":
        return this.updated(this.formatStatus(), false);
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
      taskContext: normalizeText(this.latestUserPrompt).slice(0, 2_000) || undefined,
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
      return this.rejected(
        "Test-only baseline authorization requires a declared task with pending baseline verification.",
      );
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
    return this.updated(
      `Authorized test-only baseline setup for: ${this.state.baseline.authorizedTestPaths.join(", ")}`,
    );
  }

  private recordBaseline(input: VerificationInput): VerificationResult {
    if (!this.state.taskKind || !this.state.taskSummary) {
      return this.rejected("Declare the task before baseline verification.");
    }
    if (
      !isBaselineMethod(input.baseline_method) ||
      !normalizeText(input.hypothesis) ||
      !normalizeText(input.conclusion)
    ) {
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

    const taskText = `${this.state.taskContext ?? this.latestUserPrompt}\n${this.state.taskSummary}`;
    if (input.baseline_method === "static_trace") {
      if (HIGH_RISK_PATTERN.test(taskText)) {
        return this.rejected(
          "Static trace is insufficient for signal/restart/persistence/recovery/concurrency/indexing work.",
        );
      }
      if (evidence.filter((item) => !item.isError && isStaticTool(item.toolName)).length < 2) {
        return this.rejected("static_trace requires two non-error inspection evidence handles.");
      }
    }
    if (
      input.baseline_method === "runtime_reproduction" &&
      !evidence.some(
        (item) =>
          isShellTool(item.toolName) &&
          !item.isError &&
          !GENERIC_CHECK_PATTERN.test(item.descriptor) &&
          !READ_ONLY_PATTERN.test(item.descriptor),
      )
    ) {
      return this.rejected(
        "runtime_reproduction requires successful non-generic bash evidence exercising the behavior.",
      );
    }
    if (input.baseline_method === "failing_regression_test") {
      if (this.state.baseline.authorizedTestPaths.length > 0 && !this.state.baseline.testSetupChanged) {
        return this.rejected("The authorized regression test was not created or modified before running it.");
      }
      if (
        evidence.some(
          (item) =>
            isShellTool(item.toolName) && TEST_PATTERN.test(item.descriptor) && /\s*\|\s*/.test(item.descriptor),
        )
      ) {
        return this.rejected(
          "Pipelined test commands (containing '|') mask exit codes and cannot be used for test verification evidence. Rerun the test command directly without piping.",
        );
      }
      if (
        !evidence.some(
          (item) =>
            isShellTool(item.toolName) &&
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
    const evidence = this.resolveFinalEvidence(input.evidence_refs, input.final_status === "failed");
    if (typeof evidence === "string") return this.rejected(evidence);
    const finalMethod = isFinalMethod(input.final_method) ? input.final_method : this.finalMethodForEvidence(evidence);
    const finalStatus =
      input.final_status === "passed" || input.final_status === "failed"
        ? input.final_status
        : evidence.some((item) => item.isError)
          ? "failed"
          : "passed";
    const expectedBehavior = normalizeText(input.expected_behavior) || this.state.taskSummary;
    const observedBehavior =
      normalizeText(input.observed_behavior) ||
      evidence
        .map((item) => `${item.descriptor}: ${item.outputSummary || (item.isError ? "failed" : "passed")}`)
        .join("; ");
    const unresolvedFailures = normalizeStrings(input.unresolved_failures);
    if (evidence.some((item) => item.mutationRevision !== this.state.mutationRevision)) {
      return this.rejected(
        `Final evidence is stale; all handles must come from mutation revision ${this.state.mutationRevision}.`,
      );
    }

    if (finalStatus === "failed") {
      this.state = {
        ...this.state,
        final: {
          status: "failed",
          expectedBehavior,
          observedBehavior,
          method: finalMethod,
          evidenceRefs: evidence.map((item) => item.ref),
          unresolvedFailures,
          verifiedMutationRevision: this.state.mutationRevision,
        },
        readiness: emptyReadiness(),
        updatedAt: new Date().toISOString(),
      };
      this.persistState();
      return this.updated("Final verification recorded as failed; successful completion remains blocked.");
    }
    if (unresolvedFailures.length > 0 || evidence.some((item) => item.isError)) {
      return this.rejected("Passed final verification cannot contain unresolved failures or failed evidence.");
    }

    const taskText = `${this.state.taskContext ?? this.latestUserPrompt}\n${this.state.taskSummary}`;
    const behavioral = behavioralFinalRequired(this.state.taskKind, taskText);
    if (
      finalMethod === "static_review" &&
      (behavioral || evidence.filter((item) => isStaticTool(item.toolName)).length < 2)
    ) {
      return this.rejected(
        "static_review cannot prove behavioral code changes and otherwise requires two inspection handles.",
      );
    }
    if (
      finalMethod === "focused_test" &&
      evidence.some(
        (item) => isShellTool(item.toolName) && TEST_PATTERN.test(item.descriptor) && /\s*\|\s*/.test(item.descriptor),
      )
    ) {
      return this.rejected(
        "Pipelined test commands (containing '|') mask exit codes and cannot be used for test verification evidence. Rerun the test command directly without piping.",
      );
    }
    if (
      finalMethod === "focused_test" &&
      !evidence.some(
        (item) =>
          isShellTool(item.toolName) &&
          TEST_PATTERN.test(item.descriptor) &&
          FOCUSED_TEST_PATTERN.test(item.descriptor),
      )
    ) {
      return this.rejected("focused_test requires evidence from a specific test file or test name.");
    }
    if (
      finalMethod === "test_suite" &&
      (behavioral ||
        HIGH_RISK_PATTERN.test(taskText) ||
        !evidence.some((item) => isShellTool(item.toolName) && TEST_PATTERN.test(item.descriptor)))
    ) {
      return this.rejected("A broad test suite alone is insufficient for this behavioral task.");
    }
    if (
      finalMethod === "manual_reproduction" &&
      !evidence.some(
        (item) =>
          isShellTool(item.toolName) &&
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
        baselineEvidence.filter((item) => isShellTool(item.toolName) && !item.isError).map((item) => item.descriptor),
      );
      if (!evidence.some((item) => isShellTool(item.toolName) && baselineCommands.has(item.descriptor))) {
        return this.rejected("Final verification must rerun the same command that established the runtime baseline.");
      }
    }
    if (this.state.baseline.method === "failing_regression_test") {
      const baselineTests = new Set(
        baselineEvidence
          .filter((item) => isShellTool(item.toolName) && item.isError && TEST_PATTERN.test(item.descriptor))
          .map((item) => item.descriptor),
      );
      if (!evidence.some((item) => isShellTool(item.toolName) && baselineTests.has(item.descriptor))) {
        return this.rejected("Final verification must rerun the same focused test that failed at baseline.");
      }
    }

    this.state = {
      ...this.state,
      final: {
        status: "passed",
        expectedBehavior,
        observedBehavior,
        method: finalMethod,
        evidenceRefs: evidence.map((item) => item.ref),
        unresolvedFailures: [],
        verifiedMutationRevision: this.state.mutationRevision,
      },
      readiness: emptyReadiness(),
      updatedAt: new Date().toISOString(),
    };
    this.persistState();
    return this.updated("Final semantic verification passed for the current mutation revision.");
  }

  private readyToFinish(input: VerificationInput): VerificationResult {
    if (!isCodeTask(this.state.taskKind)) {
      return this.updated("Finish readiness certificates are not required for documentation or investigation tasks.");
    }
    if (!this.state.taskSummary || this.state.mutationRevision === 0) {
      return this.rejected("ready_to_finish requires a declared code task and at least one production mutation.");
    }
    const finalError = this.finalVerificationError("prepare successful completion");
    if (finalError) return this.rejected(finalError);

    const unresolvedFailures = normalizeStrings(input.unresolved_failures);
    if (unresolvedFailures.length > 0) {
      return this.rejected("ready_to_finish cannot pass with unresolved_failures.");
    }

    const requestedChecks = input.acceptance_checks ?? [];
    const requiredCheckCount = requiredAcceptanceCheckCount(this.taskText());
    if (requestedChecks.length < requiredCheckCount) {
      return this.rejected(
        `ready_to_finish requires at least ${requiredCheckCount} distinct acceptance_checks for the explicit guarantees in this task; received ${requestedChecks.length}.`,
      );
    }

    const acceptanceChecks: TaskVerificationAcceptanceCheck[] = [];
    const seenCriteria = new Set<string>();
    const mappedEvidence = new Map<string, TaskVerificationEvidence>();
    for (const requestedCheck of requestedChecks) {
      const criterion = normalizeText(requestedCheck.criterion);
      if (!criterion) return this.rejected("Every acceptance check requires a concrete criterion.");
      const criterionKey = criterion.toLowerCase();
      if (seenCriteria.has(criterionKey)) {
        return this.rejected(`Duplicate acceptance criterion: ${criterion}`);
      }
      seenCriteria.add(criterionKey);

      const evidence = this.resolveEvidence(requestedCheck.evidence_refs);
      if (typeof evidence === "string") return this.rejected(`${criterion}: ${evidence}`);
      if (evidence.some((item) => item.mutationRevision !== this.state.mutationRevision)) {
        return this.rejected(
          `${criterion}: all readiness evidence must come from mutation revision ${this.state.mutationRevision}.`,
        );
      }
      if (evidence.some((item) => item.isError)) {
        return this.rejected(`${criterion}: failed evidence cannot prove readiness.`);
      }
      for (const item of evidence) mappedEvidence.set(item.ref, item);
      acceptanceChecks.push({ criterion, evidenceRefs: evidence.map((item) => item.ref) });
    }

    const failedVerifications = this.latestFailedVerificationEvidence();
    if (failedVerifications.length > 0) {
      return this.rejected(
        [
          "ready_to_finish is blocked by verification commands whose latest execution still failed:",
          ...failedVerifications.map((item) => `- ${item.descriptor}: ${item.outputSummary || "failed"}`),
          "Repair the implementation and rerun each exact command successfully.",
        ].join("\n"),
      );
    }

    const mappedValues = [...mappedEvidence.values()];
    const unmappedFinalEvidence = this.state.final.evidenceRefs.filter((ref) => !mappedEvidence.has(ref));
    if (unmappedFinalEvidence.length > 0) {
      return this.rejected(
        `Acceptance checks must include the final semantic verification evidence: ${unmappedFinalEvidence.join(", ")}.`,
      );
    }
    const taskText = this.taskText();
    if (
      testsRequested(taskText) &&
      !mappedValues.some((item) => isShellTool(item.toolName) && TEST_PATTERN.test(item.descriptor))
    ) {
      return this.rejected(
        "The task explicitly requires tests, but no successful current-revision test evidence is mapped to an acceptance check.",
      );
    }
    if (
      typecheckRequested(taskText) &&
      !mappedValues.some((item) => isShellTool(item.toolName) && TYPECHECK_PATTERN.test(item.descriptor))
    ) {
      return this.rejected(
        "The task explicitly requires type checking, but no successful current-revision typecheck evidence is mapped to an acceptance check.",
      );
    }

    const token = randomUUID();
    this.state = {
      ...this.state,
      readiness: {
        status: "ready",
        token,
        acceptanceChecks,
        verifiedMutationRevision: this.state.mutationRevision,
      },
      updatedAt: new Date().toISOString(),
    };
    this.persistState();
    return this.updated(
      [
        `Finish readiness passed for mutation revision ${this.state.mutationRevision}.`,
        `verification_token: ${token}`,
        "Pass this token unchanged to finish_work. Any subsequent workspace mutation invalidates it.",
      ].join("\n"),
      false,
    );
  }

  private isAuthorizedBaselineTestMutation(toolName: string, args: unknown): boolean {
    if (
      this.state.baseline.status !== "pending" ||
      this.state.baseline.authorizedTestPaths.length === 0 ||
      !isDirectMutationTool(toolName)
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

  private resolveFinalEvidence(
    refs: readonly string[] | undefined,
    includeFailed: boolean = false,
  ): TaskVerificationEvidence[] | string {
    if (normalizeStrings(refs).length > 0) return this.resolveEvidence(refs);

    const replayDescriptor = this.requiredBaselineReplayDescriptor();
    if (replayDescriptor) {
      const replayEvidence = this.findEvidence(
        (item) =>
          item.mutationRevision === this.state.mutationRevision &&
          isShellTool(item.toolName) &&
          item.descriptor === replayDescriptor &&
          (includeFailed || !item.isError),
      );
      return replayEvidence
        ? [replayEvidence]
        : `No eligible current-revision evidence reruns the required exact baseline command: ${replayDescriptor}`;
    }

    const eligibleEvidence = this.findEligibleFinalEvidence();
    if (eligibleEvidence) return eligibleEvidence;
    if (includeFailed) {
      const failedEvidence = this.findEvidence(
        (item) => item.mutationRevision === this.state.mutationRevision && item.isError,
      );
      if (failedEvidence) return [failedEvidence];
    }
    return `No eligible semantic evidence exists for mutation revision ${this.state.mutationRevision}.`;
  }

  private resolveEvidence(refs: readonly string[] | undefined): TaskVerificationEvidence[] | string {
    const normalizedRefs = normalizeStrings(refs);
    if (normalizedRefs.length === 0) return "At least one evidence_refs handle is required.";
    const missingRefs: string[] = [];
    const resolved: TaskVerificationEvidence[] = [];

    for (const ref of normalizedRefs) {
      const cleanedRef = ref.replace(/^@/u, "").trim();
      let found = this.evidence.get(ref);
      if (!found) found = this.evidence.get(cleanedRef);
      if (!found) {
        found = [...this.evidence.values()].find((e) => e.toolCallId === ref || e.toolCallId === cleanedRef);
      }
      if (found) {
        resolved.push(found);
      } else {
        missingRefs.push(ref);
      }
    }

    if (missingRefs.length > 0) {
      const available = [...this.evidence.values()]
        .slice(-8)
        .map((e) => `${e.ref} (@${e.toolCallId})`)
        .join(", ");
      return `Unknown evidence handle(s): ${missingRefs.join(", ")}.${available ? ` Available handles: ${available}` : ""}`;
    }
    return resolved;
  }

  private taskText(): string {
    return `${this.state.taskContext ?? this.latestUserPrompt}\n${this.state.taskSummary ?? ""}`;
  }

  private latestFailedVerificationEvidence(): TaskVerificationEvidence[] {
    const latestByCommand = new Map<string, TaskVerificationEvidence>();
    for (const item of this.evidence.values()) {
      if (
        item.mutationRevision === this.state.mutationRevision &&
        isShellTool(item.toolName) &&
        (TEST_PATTERN.test(item.descriptor) || GENERIC_CHECK_PATTERN.test(item.descriptor))
      ) {
        latestByCommand.set(item.descriptor, item);
      }
    }
    return [...latestByCommand.values()].filter((item) => item.isError);
  }

  private finalVerificationError(action: string): string | undefined {
    if (this.state.baseline.required && this.state.baseline.status !== "satisfied") {
      return `Cannot ${action}: baseline verification is incomplete.`;
    }
    if (
      this.state.final.status !== "passed" ||
      this.state.final.verifiedMutationRevision !== this.state.mutationRevision
    ) {
      return `Cannot ${action}: semantic verification has not passed after mutation revision ${this.state.mutationRevision}.`;
    }
    return undefined;
  }

  private finalGate(
    action: string,
    verificationToken?: string,
    requireToken: boolean = false,
  ): BeforeToolCallResult | undefined {
    if (this.state.mutationRevision === 0) return undefined;
    const finalError = this.finalVerificationError(action);
    if (finalError) return this.blocked(finalError);
    if (!isCodeTask(this.state.taskKind)) return undefined;

    const readiness = this.state.readiness ?? emptyReadiness();
    if (
      readiness.status !== "ready" ||
      readiness.verifiedMutationRevision !== this.state.mutationRevision ||
      !readiness.token
    ) {
      return this.blocked(
        `Cannot ${action}: call ${TASK_VERIFICATION_TOOL_NAME} with action "ready_to_finish" and map every explicit acceptance criterion to fresh evidence first.`,
      );
    }
    if (requireToken && verificationToken !== readiness.token) {
      return this.blocked(
        `Cannot ${action}: pass the exact verification_token returned by ready_to_finish for mutation revision ${this.state.mutationRevision}.`,
      );
    }
    return undefined;
  }

  private restore(): void {
    for (const entry of this.sessionManager.getBranch()) {
      if (entry.type !== "custom") continue;
      if (entry.customType === TASK_VERIFICATION_STATE_CUSTOM_TYPE && isTaskVerificationState(entry.data)) {
        this.state = {
          ...entry.data,
          readiness: entry.data.readiness ?? emptyReadiness(),
        };
      }
      if (entry.customType === TASK_VERIFICATION_EVIDENCE_CUSTOM_TYPE && isTaskVerificationEvidence(entry.data)) {
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
          `${item.ref} (@${item.toolCallId}): ${item.isError ? "FAILED" : "passed"} ${item.toolName} at revision ${item.mutationRevision} — ${item.descriptor}${item.outputSummary ? ` — ${item.outputSummary}` : ""}`,
      );
    return [
      `Task: ${this.state.taskKind ?? "undeclared"}${this.state.taskSummary ? ` — ${this.state.taskSummary}` : ""}`,
      `Mutation revision: ${this.state.mutationRevision}`,
      `Baseline: ${this.state.baseline.status}`,
      `Authorized baseline tests: ${this.state.baseline.authorizedTestPaths.join(", ") || "none"}`,
      `Final: ${this.state.final.status}`,
      `Readiness: ${(this.state.readiness ?? emptyReadiness()).status}`,
      this.state.final.unresolvedFailures.length > 0
        ? `Unresolved failures: ${this.state.final.unresolvedFailures.join("; ")}`
        : undefined,
      recentEvidence.length > 0 ? `Evidence:\n- ${recentEvidence.join("\n- ")}` : "Evidence: none",
      this.formatNextRequirement(),
    ]
      .filter((line): line is string => line !== undefined)
      .join("\n");
  }

  private formatNextRequirement(): string {
    if (!this.state.taskKind || !this.state.taskSummary) {
      return [
        "Task classification is pending.",
        "Continue with inspection or baseline checks; the controller will classify the task before the first mutation.",
        `Use ${TASK_VERIFICATION_TOOL_NAME} with action "declare_task" only to override that classification before mutation.`,
      ].join("\n");
    }

    if (this.state.baseline.required && this.state.baseline.status !== "satisfied") {
      const failingEvidence = this.findEvidence(
        (item) =>
          item.mutationRevision === 0 &&
          isShellTool(item.toolName) &&
          item.isError &&
          TEST_PATTERN.test(item.descriptor) &&
          FOCUSED_TEST_PATTERN.test(item.descriptor) &&
          !/\s*\|\s*/.test(item.descriptor),
      );
      const runtimeEvidence = this.findEvidence(
        (item) =>
          item.mutationRevision === 0 &&
          isShellTool(item.toolName) &&
          !item.isError &&
          !GENERIC_CHECK_PATTERN.test(item.descriptor) &&
          !READ_ONLY_PATTERN.test(item.descriptor),
      );
      const staticEvidence = [...this.evidence.values()].filter(
        (item) => item.mutationRevision === 0 && !item.isError && isStaticTool(item.toolName),
      );

      if (failingEvidence) {
        return [
          "NEXT REQUIRED ACTION: record the already-observed failing focused regression test as the baseline.",
          `Exact baseline test command: ${failingEvidence.descriptor}`,
          `Use evidence_refs: ["${failingEvidence.ref}"]`,
          `Call ${TASK_VERIFICATION_TOOL_NAME} with:`,
          `{"action":"record_baseline","baseline_method":"failing_regression_test","hypothesis":"why the current implementation causes this failure","conclusion":"what the failed test proves","evidence_refs":["${failingEvidence.ref}"],"unresolved_assumptions":[]}`,
        ].join("\n");
      }

      if (runtimeEvidence) {
        return [
          "NEXT REQUIRED ACTION: record the already-observed runtime reproduction as the baseline.",
          `Exact reproduction command: ${runtimeEvidence.descriptor}`,
          `Use evidence_refs: ["${runtimeEvidence.ref}"]`,
          `Call ${TASK_VERIFICATION_TOOL_NAME} with:`,
          `{"action":"record_baseline","baseline_method":"runtime_reproduction","hypothesis":"causal explanation for the current behavior","conclusion":"what the reproduction proves","evidence_refs":["${runtimeEvidence.ref}"],"unresolved_assumptions":[]}`,
        ].join("\n");
      }

      const taskText = `${this.state.taskContext ?? this.latestUserPrompt}\n${this.state.taskSummary}`;
      const highRisk = HIGH_RISK_PATTERN.test(taskText);
      if (!highRisk && staticEvidence.length >= 2) {
        const refs = staticEvidence.slice(-2).map((item) => item.ref);
        return [
          "NEXT REQUIRED ACTION: record the collected static trace as the baseline.",
          `Use evidence_refs: ${JSON.stringify(refs)}`,
          `Call ${TASK_VERIFICATION_TOOL_NAME} with:`,
          `{"action":"record_baseline","baseline_method":"static_trace","hypothesis":"causal explanation supported by the inspected paths","conclusion":"what the two independent inspections prove","evidence_refs":${JSON.stringify(refs)},"unresolved_assumptions":[]}`,
        ].join("\n");
      }

      if (this.state.baseline.authorizedTestPaths.length > 0) {
        if (!this.state.baseline.testSetupChanged) {
          return [
            "NEXT REQUIRED ACTION: create or modify the authorized regression test before touching production code.",
            `Only these paths are currently writable: ${this.state.baseline.authorizedTestPaths.join(", ")}.`,
            "Then run a focused command targeting that exact test and confirm it fails for the intended behavioral reason.",
          ].join("\n");
        }
        return [
          "NEXT REQUIRED ACTION: run the authorized regression test in isolation and obtain a FAILED evidence handle.",
          `Authorized test paths: ${this.state.baseline.authorizedTestPaths.join(", ")}.`,
          "The command must target a specific test file or test name; a broad suite does not satisfy this baseline.",
          "Run the test command directly without piping (pipelined commands containing '|' are not accepted).",
          "After the failing run, call action status again to receive the exact record_baseline payload.",
        ].join("\n");
      }

      return [
        "NEXT REQUIRED ACTION: establish the pre-change behavior before production mutation.",
        highRisk
          ? "This lifecycle/durability task requires either a runtime reproduction or a failing focused regression test; static inspection is not accepted."
          : "Use a runtime reproduction, a failing focused regression test, or two independent static inspection handles.",
        `For a regression test, first call ${TASK_VERIFICATION_TOOL_NAME} with {"action":"authorize_baseline_test","test_paths":["exact/repository-relative.test.ts"]}.`,
        "For runtime reproduction, run the concrete scenario now; its bash result will receive an evidence handle. Then call action status again.",
      ].join("\n");
    }

    if (this.state.mutationRevision === 0) {
      return [
        "NEXT REQUIRED ACTION: implement the production change; the baseline gate is satisfied.",
        this.baselineReplayInstruction(),
        "After the final production mutation, rerun the required behavior and call action status again before record_final.",
      ].join("\n");
    }

    if (
      this.state.final.status === "passed" &&
      this.state.final.verifiedMutationRevision === this.state.mutationRevision
    ) {
      if (!isCodeTask(this.state.taskKind)) {
        return "NEXT REQUIRED ACTION: none. Final semantic verification is current; successful finish_work and git commit/push are unblocked.";
      }
      const readiness = this.state.readiness ?? emptyReadiness();
      if (
        readiness.status === "ready" &&
        readiness.verifiedMutationRevision === this.state.mutationRevision &&
        readiness.token
      ) {
        return [
          "NEXT REQUIRED ACTION: readiness is current; git commit/push are unblocked.",
          `Call finish_work with verification_token "${readiness.token}".`,
        ].join("\n");
      }
      const requiredCheckCount = requiredAcceptanceCheckCount(this.taskText());
      const currentEvidence = [...this.evidence.values()]
        .filter((item) => item.mutationRevision === this.state.mutationRevision && !item.isError)
        .slice(-8)
        .map((item) => `${item.ref}: ${item.descriptor}`);
      return [
        `NEXT REQUIRED ACTION: call ${TASK_VERIFICATION_TOOL_NAME} with action "ready_to_finish".`,
        `Re-read the original request and provide at least ${requiredCheckCount} distinct acceptance_checks covering every explicit requirement, negative guarantee, and boundary condition.`,
        "Map every criterion to fresh current-revision evidence_refs and pass unresolved_failures: [].",
        testsRequested(this.taskText())
          ? "The original task requests tests, so acceptance evidence must include a successful test command."
          : undefined,
        typecheckRequested(this.taskText())
          ? "The original task requests type checking, so acceptance evidence must include a successful typecheck command."
          : undefined,
        currentEvidence.length > 0 ? `Fresh evidence:\n- ${currentEvidence.join("\n- ")}` : "Fresh evidence: none",
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n");
    }

    const replayDescriptor = this.requiredBaselineReplayDescriptor();
    if (replayDescriptor) {
      const replayEvidence = this.findEvidence(
        (item) =>
          item.mutationRevision === this.state.mutationRevision &&
          isShellTool(item.toolName) &&
          item.descriptor === replayDescriptor,
      );

      if (replayEvidence?.isError) {
        return [
          "NEXT REQUIRED ACTION: the required baseline replay still fails; repair the implementation before recording final success.",
          `Failed replay command: ${replayEvidence.descriptor}`,
          `Failed evidence: ${replayEvidence.ref} — ${replayEvidence.outputSummary || "no output summary"}`,
          "After the next production mutation, rerun the same command and call action status again.",
        ].join("\n");
      }

      if (!replayEvidence) {
        return [
          "NEXT REQUIRED ACTION: rerun the exact scenario that established the baseline.",
          `Required exact replay command: ${replayDescriptor}`,
          `Only evidence from mutation revision ${this.state.mutationRevision} is eligible.`,
          "Do not substitute another focused test, broad suite, lint, or typecheck for this replay.",
          "Run the command directly without piping.",
          "After the successful replay, call action status again to receive the exact record_final payload.",
        ].join("\n");
      }

      return this.formatFinalRecordGuidance(
        [replayEvidence],
        this.state.baseline.method === "failing_regression_test" ? "focused_test" : "manual_reproduction",
      );
    }

    const eligibleEvidence = this.findEligibleFinalEvidence();
    if (eligibleEvidence) return this.formatFinalRecordGuidance(eligibleEvidence);

    return [
      "NEXT REQUIRED ACTION: collect fresh semantic evidence for the current mutation revision before completion.",
      this.baselineReplayInstruction(),
      `Only evidence from mutation revision ${this.state.mutationRevision} is eligible.`,
      "After the successful run, call action status again to receive the exact record_final payload and evidence handle.",
    ].join("\n");
  }

  private baselineReplayInstruction(): string {
    const descriptor = this.requiredBaselineReplayDescriptor();
    if (!descriptor)
      return "Run a focused behavior-specific test or manual reproduction; generic lint/typecheck output is not sufficient.";
    return `Required exact replay command: ${descriptor}`;
  }

  private requiredBaselineReplayDescriptor(): string | undefined {
    if (this.state.baseline.method === "runtime_reproduction") {
      return this.state.baseline.evidenceRefs
        .map((ref) => this.evidence.get(ref))
        .find((item) => item && isShellTool(item.toolName) && !item.isError)?.descriptor;
    }
    if (this.state.baseline.method === "failing_regression_test") {
      return this.state.baseline.evidenceRefs
        .map((ref) => this.evidence.get(ref))
        .find((item) => item && isShellTool(item.toolName) && item.isError && TEST_PATTERN.test(item.descriptor))
        ?.descriptor;
    }
    return undefined;
  }

  private tryAutoFinalizeExactReplay(evidence: TaskVerificationEvidence): string | undefined {
    if (
      evidence.isError ||
      evidence.mutationRevision === 0 ||
      !this.state.taskKind ||
      !this.state.taskSummary ||
      this.state.baseline.status !== "satisfied" ||
      evidence.descriptor !== this.requiredBaselineReplayDescriptor()
    ) {
      return undefined;
    }

    this.state = {
      ...this.state,
      final: {
        status: "passed",
        expectedBehavior: this.state.taskSummary,
        observedBehavior: `${evidence.descriptor}: ${evidence.outputSummary || "passed"}`,
        method: this.state.baseline.method === "failing_regression_test" ? "focused_test" : "manual_reproduction",
        evidenceRefs: [evidence.ref],
        unresolvedFailures: [],
        verifiedMutationRevision: this.state.mutationRevision,
      },
      readiness: emptyReadiness(),
      updatedAt: new Date().toISOString(),
    };
    this.persistState();
    return "Exact baseline replay passed and final verification was recorded automatically. Complete ready_to_finish before finish_work.";
  }

  private tryAutoFinalizeFocusedTest(evidence: TaskVerificationEvidence): string | undefined {
    if (
      evidence.isError ||
      evidence.mutationRevision === 0 ||
      !this.state.taskKind ||
      !this.state.taskSummary ||
      this.state.baseline.status === "pending" ||
      !isShellTool(evidence.toolName) ||
      !TEST_PATTERN.test(evidence.descriptor) ||
      !FOCUSED_TEST_PATTERN.test(evidence.descriptor) ||
      /\s*\|\s*/u.test(evidence.descriptor)
    ) {
      return undefined;
    }

    const result = this.recordFinal({
      action: "record_final",
      final_method: "focused_test",
      final_status: "passed",
      evidence_refs: [evidence.ref],
      unresolved_failures: [],
    });
    if (result.status !== "updated" || this.state.final.status !== "passed") return undefined;
    return "Focused semantic verification passed and final verification was recorded automatically. Complete ready_to_finish before finish_work.";
  }

  private highRiskAcceptanceAudit(evidence: TaskVerificationEvidence): string | undefined {
    if (
      evidence.isError ||
      evidence.mutationRevision === 0 ||
      !this.state.taskKind ||
      !this.state.taskSummary ||
      !isShellTool(evidence.toolName) ||
      !TEST_PATTERN.test(evidence.descriptor) ||
      FOCUSED_TEST_PATTERN.test(evidence.descriptor)
    ) {
      return undefined;
    }
    const taskText = `${this.state.taskContext ?? this.latestUserPrompt}\n${this.state.taskSummary}`;
    if (!HIGH_RISK_PATTERN.test(taskText)) return undefined;
    return [
      "HIGH-RISK ACCEPTANCE AUDIT REQUIRED before completion: a broad suite passed, but it does not prove every explicit guarantee.",
      "Re-read the original task and run focused adversarial tests for each absolute or negative requirement.",
      "Preserve exact public API return shapes without invented wrappers; use lossless identities containing every relevant input and option.",
      "Test the literal smallest boundary mutation (for a newline-terminated serialization, remove exactly one final byte rather than a whole line or record).",
      "After failed atomic operations, retry every attempted identity with both identical and changed payloads to prove complete rollback.",
      "A successful focused test command records final verification, but ready_to_finish still requires explicit requirement-to-evidence mappings.",
    ].join("\n");
  }

  private findEligibleFinalEvidence(): TaskVerificationEvidence[] | undefined {
    const current = [...this.evidence.values()].filter(
      (item) => item.mutationRevision === this.state.mutationRevision && !item.isError,
    );
    const newestFirst = current.slice().reverse();
    const focusedTest = newestFirst.find(
      (item) =>
        isShellTool(item.toolName) &&
        TEST_PATTERN.test(item.descriptor) &&
        FOCUSED_TEST_PATTERN.test(item.descriptor) &&
        !/\s*\|\s*/.test(item.descriptor),
    );
    if (focusedTest) return [focusedTest];

    const manualReproduction = newestFirst.find(
      (item) =>
        isShellTool(item.toolName) &&
        !TEST_PATTERN.test(item.descriptor) &&
        !GENERIC_CHECK_PATTERN.test(item.descriptor) &&
        !READ_ONLY_PATTERN.test(item.descriptor),
    );
    if (manualReproduction) return [manualReproduction];

    const taskText = `${this.state.taskContext ?? this.latestUserPrompt}\n${this.state.taskSummary ?? ""}`;
    const behavioral = this.state.taskKind ? behavioralFinalRequired(this.state.taskKind, taskText) : true;
    const highRisk = HIGH_RISK_PATTERN.test(taskText);
    if (!behavioral && !highRisk) {
      const testSuite = newestFirst.find((item) => isShellTool(item.toolName) && TEST_PATTERN.test(item.descriptor));
      if (testSuite) return [testSuite];
    }

    if (!behavioral) {
      const staticEvidence = current.filter((item) => isStaticTool(item.toolName));
      if (staticEvidence.length >= 2) return staticEvidence.slice(-2);
    }
    return undefined;
  }

  private finalMethodForEvidence(evidence: readonly TaskVerificationEvidence[]): FinalMethod {
    if (evidence.length >= 2 && evidence.every((item) => isStaticTool(item.toolName))) {
      return "static_review";
    }
    const primary = evidence[0];
    if (!primary) return "manual_reproduction";
    if (
      isShellTool(primary.toolName) &&
      TEST_PATTERN.test(primary.descriptor) &&
      FOCUSED_TEST_PATTERN.test(primary.descriptor)
    ) {
      return "focused_test";
    }
    if (isShellTool(primary.toolName) && TEST_PATTERN.test(primary.descriptor)) return "test_suite";
    return "manual_reproduction";
  }

  private formatFinalRecordGuidance(
    evidence: readonly TaskVerificationEvidence[],
    method: FinalMethod = this.finalMethodForEvidence(evidence),
  ): string {
    const refs = evidence.map((item) => item.ref);
    const evidenceLines = evidence.map((item) => `- ${item.ref}: ${item.descriptor}`);
    const payload = JSON.stringify({
      action: "record_final",
      final_method: method,
      final_status: "passed",
      expected_behavior: "the behavior that must now hold",
      observed_behavior: "what this evidence demonstrated",
      evidence_refs: refs,
      unresolved_failures: [],
    });
    return [
      "NEXT REQUIRED ACTION: record final verification using the successful semantic evidence already collected for the current mutation revision.",
      `Eligible evidence:\n${evidenceLines.join("\n")}`,
      `Use evidence_refs: ${JSON.stringify(refs)}`,
      `Call ${TASK_VERIFICATION_TOOL_NAME} with:`,
      payload,
    ].join("\n");
  }

  private findEvidence(
    predicate: (evidence: TaskVerificationEvidence) => boolean,
  ): TaskVerificationEvidence | undefined {
    return [...this.evidence.values()].reverse().find(predicate);
  }

  private withGuidance(message: string): string {
    return `${message}\n\n${this.formatNextRequirement()}\n\nTo inspect the complete durable verification state at any time, call ${TASK_VERIFICATION_TOOL_NAME} with {"action":"status"}.`;
  }

  private blocked(message: string): BeforeToolCallResult {
    return { block: true, reason: this.withGuidance(message) };
  }

  private updated(message: string, includeGuidance: boolean = true): VerificationResult {
    return {
      status: "updated",
      message: includeGuidance ? `${message}\n\n${this.formatNextRequirement()}` : message,
      state: this.currentState,
    };
  }

  private rejected(message: string): VerificationResult {
    return { status: "needs_action", message, state: this.currentState };
  }
}

export function createTaskVerificationController(sessionManager: SessionManager): TaskVerificationController {
  return new TaskVerificationController(sessionManager);
}
