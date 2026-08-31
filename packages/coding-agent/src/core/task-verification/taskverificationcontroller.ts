import type {
  AfterToolCallContext,
  AfterToolCallResult,
  Agent,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "@dst0/p-agent-core";
import type { ToolDefinition } from "../extensions/types.ts";
import type { SessionManager } from "../session-manager.ts";
import type { EvidenceVerificationSchema, RequirementAuditSchema, VerificationSchema } from "./constants.ts";
import { DEFAULT_TASK_VERIFICATION_MODE, type TaskVerificationMode } from "./mode.ts";
import type { RejectedRequirementDefinitionDraft } from "./requirement-definition-repair.ts";
import { emptyState } from "./state-factories.ts";
import {
  do_blocked,
  do_finalMethodForEvidence,
  do_findEligibleFinalEvidence,
  do_findEvidence,
  do_formatFinalRecordGuidance,
  do_highRiskAcceptanceAudit,
  do_rejected,
  do_requiredBaselineReplayDescriptor,
  do_tryAutoFinalizeExactReplay,
  do_tryAutoFinalizeFocusedTest,
  do_updated,
  do_withGuidance,
} from "./taskverificationcontroller-methods/auto-finalization.ts";
import { do_recordBaseline } from "./taskverificationcontroller-methods/baseline-recording.ts";
import {
  completionGateWithEvidence,
  formatEvidenceStatus,
  publishGateWithEvidence,
  readyToFinishWithEvidence,
} from "./taskverificationcontroller-methods/evidence-readiness.ts";
import {
  do_completionGate,
  do_finalVerificationError,
  do_formatStatus,
  do_latestFailedVerificationEvidence,
  do_persistState,
  do_publishGate,
  do_resolveEvidence,
  do_restore,
  do_taskText,
} from "./taskverificationcontroller-methods/evidence-resolution.ts";
import { do_recordFinal } from "./taskverificationcontroller-methods/final-recording.ts";
import {
  do_afterToolCall,
  do_applyInput,
  do_authorizeBaselineTest,
  do_detectMutation,
} from "./taskverificationcontroller-methods/mutation-tracking.ts";
import {
  do_isAuthorizedBaselineTestMutation,
  do_readyToFinish,
  do_resolveFinalEvidence,
} from "./taskverificationcontroller-methods/readiness-check.ts";
import {
  do_applyRequirementAudit,
  do_beginAuditTransition,
} from "./taskverificationcontroller-methods/requirement-audit.ts";
import { do_createRequirementAuditToolDefinition } from "./taskverificationcontroller-methods/requirement-audit-tool.ts";
import {
  do_baselineReplayInstruction,
  do_formatNextRequirement,
} from "./taskverificationcontroller-methods/requirement-formatting.ts";
import type { SourceWorkspaceSnapshot } from "./taskverificationcontroller-methods/source-workspace-snapshot.ts";
import { declareTask } from "./taskverificationcontroller-methods/task-declaration.ts";
import { createTaskVerificationToolDefinition } from "./taskverificationcontroller-methods/task-verification-tool-definition.ts";
import type { TestWorkspaceSnapshot } from "./taskverificationcontroller-methods/test-workspace-snapshot.ts";
import { do_beforeToolCall, do_install } from "./taskverificationcontroller-methods/tool-integration.ts";
import type {
  FinalMethod,
  RequirementAuditInput,
  TaskVerificationEvidence,
  TaskVerificationState,
  VerificationInput,
  VerificationResult,
} from "./types.ts";

export class TaskVerificationController {
  readonly mode: TaskVerificationMode;
  readonly toolDefinition: ToolDefinition;
  readonly requirementAuditToolDefinition: ToolDefinition;
  public readonly sessionManager: SessionManager;
  public readonly evidence = new Map<string, TaskVerificationEvidence>();
  public readonly bashFingerprints = new Map<string, string | undefined>();
  public readonly testMutationReservations = new Map<string, string[]>();
  public readonly testVerificationStarts = new Map<
    string,
    { mutationAttemptRevision: number; mutationRevision: number; unverifiedTestPaths: string[] }
  >();
  public readonly workspaceTestSnapshots = new Map<string, TestWorkspaceSnapshot | undefined>();
  public readonly workspaceSourceSnapshots = new Map<string, SourceWorkspaceSnapshot | undefined>();
  public readonly activeMutationAttempts = new Set<string>();
  public mutationAttemptRevision = 0;
  public readonly requirementSourceTexts = new Map<string, string>();
  public rejectedRequirementDefinitionDraft?: RejectedRequirementDefinitionDraft;
  public state = emptyState();
  public latestUserPrompt = "";
  public nextEvidence = 1;
  public installed = false;
  public modelTurn = 0;
  public lastAuditTransitionTurn = -1;
  public restoreError?: string;

  constructor(sessionManager: SessionManager, mode: TaskVerificationMode = DEFAULT_TASK_VERIFICATION_MODE) {
    this.mode = mode;
    this.sessionManager = sessionManager;
    this.restore();
    this.toolDefinition = this.createToolDefinition() as unknown as ToolDefinition;
    this.requirementAuditToolDefinition = this.createRequirementAuditToolDefinition() as unknown as ToolDefinition;
  }

  get currentState(): TaskVerificationState {
    return structuredClone(this.state);
  }
  install(agent: Agent): void {
    do_install(this, agent);
  }

  createToolDefinition(): ToolDefinition<
    typeof VerificationSchema | typeof EvidenceVerificationSchema,
    VerificationResult
  > {
    return createTaskVerificationToolDefinition(this);
  }
  createRequirementAuditToolDefinition(): ToolDefinition<typeof RequirementAuditSchema, VerificationResult> {
    return do_createRequirementAuditToolDefinition(this);
  }

  beforeToolCall(context: BeforeToolCallContext): BeforeToolCallResult | undefined {
    return do_beforeToolCall(this, context);
  }
  async afterToolCall(
    context: AfterToolCallContext,
    previousResult: AfterToolCallResult | undefined,
  ): Promise<AfterToolCallResult | undefined> {
    return do_afterToolCall(this, context, previousResult);
  }

  async detectMutation(context: AfterToolCallContext, isError: boolean): Promise<boolean> {
    return do_detectMutation(this, context, isError);
  }
  applyInput(input: VerificationInput): VerificationResult {
    if (this.mode === "off") return this.rejected("Task verification is disabled for this session.");
    if (this.mode === "evidence" && input.action !== "ready_to_finish" && input.action !== "status") {
      return this.updated(
        'This semantic verification action is not required in evidence mode. Collect fresh evidence, then call action "ready_to_finish" with one completion checklist.',
        false,
      );
    }
    return do_applyInput(this, input);
  }

  applyRequirementAudit(input: RequirementAuditInput): VerificationResult {
    if (this.mode !== "audit") {
      return this.rejected("Requirement audit is available only when task verification mode is audit.");
    }
    return do_applyRequirementAudit(this, input);
  }
  beginAuditTransition(): string | undefined {
    return do_beginAuditTransition(this);
  }

  declareTask(input: VerificationInput): VerificationResult {
    return declareTask(this, input);
  }

  authorizeBaselineTest(input: VerificationInput): VerificationResult {
    return do_authorizeBaselineTest(this, input);
  }

  recordBaseline(input: VerificationInput): VerificationResult {
    return do_recordBaseline(this, input);
  }

  recordFinal(input: VerificationInput): VerificationResult {
    return do_recordFinal(this, input);
  }

  readyToFinish(input: VerificationInput): VerificationResult {
    return this.mode === "evidence" ? readyToFinishWithEvidence(this, input) : do_readyToFinish(this, input);
  }
  isAuthorizedBaselineTestMutation(toolName: string, args: unknown): boolean {
    return do_isAuthorizedBaselineTestMutation(this, toolName, args);
  }

  resolveFinalEvidence(
    refs: readonly string[] | undefined,
    includeFailed: boolean = false,
  ): TaskVerificationEvidence[] | string {
    return do_resolveFinalEvidence(this, refs, includeFailed);
  }

  resolveEvidence(refs: readonly string[] | undefined): TaskVerificationEvidence[] | string {
    return do_resolveEvidence(this, refs);
  }

  taskText(): string {
    return do_taskText(this);
  }

  latestFailedVerificationEvidence(): TaskVerificationEvidence[] {
    return do_latestFailedVerificationEvidence(this);
  }

  finalVerificationError(action: string): string | undefined {
    return do_finalVerificationError(this, action);
  }

  publishGate(action: string): BeforeToolCallResult | undefined {
    return this.mode === "evidence" ? publishGateWithEvidence(this, action) : do_publishGate(this, action);
  }

  completionGate(action: string, verificationToken?: string, filesChanged?: unknown): BeforeToolCallResult | undefined {
    return this.mode === "evidence"
      ? completionGateWithEvidence(this, action, verificationToken, filesChanged)
      : do_completionGate(this, action, verificationToken);
  }

  restore(): void {
    do_restore(this);
  }

  persistState(): void {
    do_persistState(this);
  }

  formatStatus(): string {
    return this.mode === "evidence" ? formatEvidenceStatus(this) : do_formatStatus(this);
  }
  formatNextRequirement(): string {
    if (this.mode === "evidence") {
      if (this.state.readiness?.status === "completion_ready" && this.state.readiness.token) {
        return `Call finish_work with verification_token "${this.state.readiness.token}".`;
      }
      if (this.state.mutationRevision === 0) {
        return "Apply the requested change; evidence mode does not require task classification or semantic definition.";
      }
      return 'Collect fresh verification evidence, then call record_task_verification with action "ready_to_finish" and one evidence-backed completion checklist.';
    }
    return do_formatNextRequirement(this);
  }

  baselineReplayInstruction(): string {
    return do_baselineReplayInstruction(this);
  }

  requiredBaselineReplayDescriptor(): string | undefined {
    return do_requiredBaselineReplayDescriptor(this);
  }

  tryAutoFinalizeExactReplay(evidence: TaskVerificationEvidence): string | undefined {
    return do_tryAutoFinalizeExactReplay(this, evidence);
  }

  tryAutoFinalizeFocusedTest(evidence: TaskVerificationEvidence): string | undefined {
    return do_tryAutoFinalizeFocusedTest(this, evidence);
  }

  highRiskAcceptanceAudit(evidence: TaskVerificationEvidence): string | undefined {
    return do_highRiskAcceptanceAudit(this, evidence);
  }

  findEligibleFinalEvidence(): TaskVerificationEvidence[] | undefined {
    return do_findEligibleFinalEvidence(this);
  }

  finalMethodForEvidence(evidence: readonly TaskVerificationEvidence[]): FinalMethod {
    return do_finalMethodForEvidence(this, evidence);
  }

  formatFinalRecordGuidance(
    evidence: readonly TaskVerificationEvidence[],
    method: FinalMethod = this.finalMethodForEvidence(evidence),
  ): string {
    return do_formatFinalRecordGuidance(this, evidence, method);
  }

  findEvidence(predicate: (evidence: TaskVerificationEvidence) => boolean): TaskVerificationEvidence | undefined {
    return do_findEvidence(this, predicate);
  }

  withGuidance(message: string): string {
    return do_withGuidance(this, message);
  }

  blocked(message: string): BeforeToolCallResult {
    return do_blocked(this, message);
  }

  updated(message: string, includeGuidance: boolean = true): VerificationResult {
    return do_updated(this, message, includeGuidance);
  }

  rejected(message: string): VerificationResult {
    return do_rejected(this, message);
  }
}
