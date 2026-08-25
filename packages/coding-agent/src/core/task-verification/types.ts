import type { Static } from "typebox";
import type {
  BASELINE_METHODS,
  FINAL_METHODS,
  REQUIREMENT_TYPES,
  RequirementAuditSchema,
  TASK_KINDS,
  VerificationSchema,
} from "./constants.ts";
import type { REQUIREMENT_PROOF_POLICIES } from "./requirement-proof-policies.ts";

export type TaskKind = (typeof TASK_KINDS)[number];

export type BaselineMethod = (typeof BASELINE_METHODS)[number];

export type FinalMethod = (typeof FINAL_METHODS)[number];

export type RequirementType = (typeof REQUIREMENT_TYPES)[number];

export type RequirementProofPolicy = (typeof REQUIREMENT_PROOF_POLICIES)[number];

export interface TaskVerificationSourcePrompt {
  id: string;
  text: string;
  kind?: "user_prompt" | "referenced_file";
  path?: string;
  sha256?: string;
}

export interface TaskVerificationRequirementSourceRef {
  id: string;
  path: string;
  sha256: string;
  byteLength: number;
  snapshotEntryId: string;
  referencedByPromptIds: string[];
  capturedAtMutationRevision: number;
  origin: "requirement_audit.prepare_definition";
  policyVersion: 1;
}

export interface TaskVerificationRequirementSourceSnapshot {
  version: 1;
  taskId: string;
  sourceId: string;
  path: string;
  sha256: string;
  byteLength: number;
  referencedByPromptIds: string[];
  capturedAtMutationRevision: number;
  text: string;
}

export interface IgnoredTaskVerificationRequirementSource {
  path: string;
  reason: string;
  deauthorizedByPromptId?: string;
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
  sourceClauseIds?: string[];
  sourceFacetIds?: string[];
  highRisk?: boolean;
  highRiskSourcePromptIndexes?: number[];
  proofPolicies?: RequirementProofPolicy[];
  verdict?: TaskRequirementVerdict;
}

export interface IgnoredSourcePrompt {
  sourcePromptIndex: number;
  reason: string;
}

export interface IgnoredSourceClause {
  sourceClauseId: string;
  classification: "informational" | "example" | "superseded" | "unsafe_instruction";
  reason: string;
  supersededBySourcePromptIndex?: number;
}

export interface TaskRequirementAuditState {
  status: "pending" | "awaiting_definition" | "verifying" | "failed" | "passed";
  requirements: TaskRequirement[];
  ignoredSourcePrompts: IgnoredSourcePrompt[];
  ignoredSourceClauses?: IgnoredSourceClause[];
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
  /** Metadata-only references to immutable requirement-source snapshot entries. */
  requirementSourceRefs?: TaskVerificationRequirementSourceRef[];
  /** Explicit model classifications for prompt-derived candidates not selected as task requirements. */
  ignoredRequirementSources?: IgnoredTaskVerificationRequirementSource[];
  /** Distinct changed test paths awaiting a trustworthy successful test command. */
  unverifiedTestPaths?: string[];
  /** A pathless mutation changed more test files than can be tracked individually. */
  unverifiedTestPathOverflow?: boolean;
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
  proofWitnesses?: TaskVerificationProofWitness[];
  isError: boolean;
  mutationRevision: number;
  timestamp: string;
}

export interface TaskVerificationProofWitness {
  requirementId: string;
  policy: RequirementProofPolicy;
  requirementSetHash: string;
  mutationRevision: number;
  factsHash: string;
}

export type VerificationInput = Static<typeof VerificationSchema>;

export type RequirementAuditInput = Static<typeof RequirementAuditSchema>;

export interface VerificationResult {
  status: "updated" | "needs_action";
  message: string;
  state: TaskVerificationState;
  requirementDefinitionDiagnosticCount?: number;
}
