import type { Static } from "typebox";
import type { BASELINE_METHODS, EXECUTION_MODES, FINAL_METHODS, TASK_KINDS, VerificationSchema } from "./constants.ts";

export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export type TaskKind = (typeof TASK_KINDS)[number];

export type BaselineMethod = (typeof BASELINE_METHODS)[number];

export type FinalMethod = (typeof FINAL_METHODS)[number];

export interface TaskVerificationAcceptanceCheck {
  criterion: string;
  evidenceRefs: string[];
}

export interface TaskVerificationState {
  version: 1;
  mode?: ExecutionMode;
  taskKind?: TaskKind;
  taskSummary?: string;
  /** Original user task context retained across compaction/session restore. */
  taskContext?: string;
  /** Accumulated user prompts since task start or last finish_work. */
  taskPrompts?: string[];
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

export type VerificationInput = Static<typeof VerificationSchema>;

export interface VerificationResult {
  status: "updated" | "needs_action";
  message: string;
  state: TaskVerificationState;
  mode?: ExecutionMode;
}
