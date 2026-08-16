import type { Static } from "typebox";
import type {
  BASELINE_METHODS,
  FINAL_METHODS,
  REQUIREMENT_TYPES,
  RequirementAuditSchema,
  TASK_KINDS,
  VerificationSchema,
} from "./constants.ts";

export type TaskKind = (typeof TASK_KINDS)[number];

export type BaselineMethod = (typeof BASELINE_METHODS)[number];

export type FinalMethod = (typeof FINAL_METHODS)[number];

export type RequirementType = (typeof REQUIREMENT_TYPES)[number];

export interface TaskVerificationSourcePrompt {
  id: string;
  text: string;
}

export interface TaskRequirementVerdict {
  passed: boolean;
  reason: string;
  evidenceRefs: string[];
  mutationRevision: number;
}

export interface TaskRequirement {
  id: string;
  type: RequirementType;
  text: string;
  acceptanceCriterion: string;
  sourcePromptIndexes: number[];
  verdict?: TaskRequirementVerdict;
}

export interface IgnoredSourcePrompt {
  sourcePromptIndex: number;
  reason: string;
}

export interface TaskRequirementAuditState {
  status: "pending" | "awaiting_definition" | "verifying" | "failed" | "passed";
  requirements: TaskRequirement[];
  ignoredSourcePrompts: IgnoredSourcePrompt[];
  nextRequirementIndex: number;
  userRequirementsHash?: string;
  requirementSetHash?: string;
  verifiedMutationRevision?: number;
}

export interface TaskVerificationAcceptanceCheck {
  criterion: string;
  evidenceRefs: string[];
}

export interface TaskVerificationState {
  version: 2;
  taskId: string;
  taskKind?: TaskKind;
  taskSummary?: string;
  /** Original user task context retained across compaction/session restore. */
  taskContext?: string;
  /** Accumulated user prompts since task start or last finish_work. */
  taskPrompts?: TaskVerificationSourcePrompt[];
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
    status: "pending" | "evidence_ready" | "completion_ready";
    token?: string;
    acceptanceChecks: TaskVerificationAcceptanceCheck[];
    verifiedMutationRevision?: number;
    userRequirementsHash?: string;
    requirementSetHash?: string;
    certificateHash?: string;
  };
  requirementAudit: TaskRequirementAuditState;
  updatedAt: string;
}

export interface TaskVerificationEvidence {
  version: 2;
  taskId: string;
  ref: string;
  toolCallId: string;
  toolName: string;
  descriptor: string;
  outputSummary: string;
  isError: boolean;
  mutationRevision: number;
  timestamp: string;
}

export type VerificationInput = Static<typeof VerificationSchema>;

export type RequirementAuditInput = Static<typeof RequirementAuditSchema>;

export interface VerificationResult {
  status: "updated" | "needs_action";
  message: string;
  state: TaskVerificationState;
}
