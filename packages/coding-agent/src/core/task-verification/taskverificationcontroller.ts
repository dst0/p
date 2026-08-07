import type {
  AfterToolCallContext,
  AfterToolCallResult,
  Agent,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "@dst0/p-agent-core";
import type { ToolDefinition } from "../extensions/types.ts";
import type { SessionManager } from "../session-manager.ts";
import type { VerificationSchema } from "./constants.ts";
import { emptyState } from "./helpers-part1.ts";
import {
  do_beforeToolCall,
  do_createToolDefinition,
  do_install,
} from "./taskverificationcontroller-methods/methods-part1.ts";
import {
  do_afterToolCall,
  do_applyInput,
  do_authorizeBaselineTest,
  do_declareTask,
  do_detectMutation,
} from "./taskverificationcontroller-methods/methods-part2.ts";
import { do_recordBaseline } from "./taskverificationcontroller-methods/methods-part3.ts";
import { do_recordFinal } from "./taskverificationcontroller-methods/methods-part4.ts";
import {
  do_isAuthorizedBaselineTestMutation,
  do_readyToFinish,
  do_resolveFinalEvidence,
} from "./taskverificationcontroller-methods/methods-part5.ts";
import {
  do_finalGate,
  do_finalVerificationError,
  do_formatStatus,
  do_latestFailedVerificationEvidence,
  do_persistState,
  do_resolveEvidence,
  do_restore,
  do_taskText,
} from "./taskverificationcontroller-methods/methods-part6.ts";
import {
  do_baselineReplayInstruction,
  do_formatNextRequirement,
} from "./taskverificationcontroller-methods/methods-part7.ts";
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
} from "./taskverificationcontroller-methods/methods-part8.ts";
import type {
  FinalMethod,
  TaskVerificationEvidence,
  TaskVerificationState,
  VerificationInput,
  VerificationResult,
} from "./types.ts";

export class TaskVerificationController {
  readonly toolDefinition: ToolDefinition;

  public readonly sessionManager: SessionManager;

  public readonly evidence = new Map<string, TaskVerificationEvidence>();

  public readonly bashFingerprints = new Map<string, string | undefined>();

  public readonly mutatedSourceFiles = new Set<string>();

  public state = emptyState();

  public latestUserPrompt = "";

  public nextEvidence = 1;

  public installed = false;

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
    this.restore();
    this.toolDefinition = this.createToolDefinition() as unknown as ToolDefinition;
  }

  get currentState(): TaskVerificationState {
    return structuredClone(this.state);
  }

  install(agent: Agent): void {
    do_install(this, agent);
  }

  createToolDefinition(): ToolDefinition<typeof VerificationSchema, VerificationResult> {
    return do_createToolDefinition(this);
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
    return do_applyInput(this, input);
  }

  declareTask(input: VerificationInput): VerificationResult {
    return do_declareTask(this, input);
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
    return do_readyToFinish(this, input);
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

  finalGate(
    action: string,
    verificationToken?: string,
    requireToken: boolean = false,
  ): BeforeToolCallResult | undefined {
    return do_finalGate(this, action, verificationToken, requireToken);
  }

  restore(): void {
    do_restore(this);
  }

  persistState(): void {
    do_persistState(this);
  }

  formatStatus(): string {
    return do_formatStatus(this);
  }

  formatNextRequirement(): string {
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
