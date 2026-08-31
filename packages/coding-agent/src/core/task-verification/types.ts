import type { Static } from "typebox";
import type {
  BASELINE_METHODS,
  FINAL_METHODS,
  REQUIREMENT_TYPES,
  TASK_KINDS,
  VerificationSchema,
} from "./constants.ts";
import type { TaskVerificationExternalEffectReceipt } from "./external-effect-state.ts";
import type { TaskVerificationMode } from "./mode.ts";
import type { RequirementAuditInputSchema } from "./requirement-audit-schema.ts";
import type { REQUIREMENT_PROOF_POLICIES } from "./requirement-proof-policies.ts";
import type { TaskOwnedPathBaseline } from "./workspace-effect-state.ts";

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
  /** Number of direct prompts that preceded this source in the definition catalog when captured. */
  definitionSourcePromptCount: number;
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
  definitionSourcePromptCount: number;
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

export interface PersistedRejectedRequirementDefinitionDraft {
  revision: string;
  diagnostics: string;
  input: RequirementAuditInput;
  repairLineageBaselineRequirementCount: number;
  bestDiagnosticCount: number;
  unproductiveRepairAttempts: number;
  knownNormativeSourceClauseIds?: string[];
}

export interface TaskVerificationState {
  version: 2;
  mode?: TaskVerificationMode;
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
  /** Bounded source paths changed by the current task. */
  mutatedSourcePaths?: string[];
  /** Source mutation scope exceeded bounds or could not be observed safely. */
  mutatedSourcePathOverflow?: boolean;
  /** Bounded, actual workspace paths changed by successful mutations in this task. */
  taskOwnedPaths?: string[];
  /** Pre-task path states used to avoid claiming unrelated pre-existing dirty paths. */
  taskOwnedPathBaselines?: TaskOwnedPathBaseline[];
  /** More task-owned paths changed than the deterministic ledger can retain. */
  taskOwnedPathOverflow?: boolean;
  /** At least one successful workspace mutation could not be identified safely. */
  taskOwnedPathTrackingFailed?: boolean;
  /** Metadata-only receipts for successful external effects in this task. */
  externalEffectReceipts?: TaskVerificationExternalEffectReceipt[];
  externalEffectReceiptOverflow?: boolean;
  /** A successful unknown effect could not be classified safely. */
  effectTrackingFailed?: boolean;
  /** Enables fail-closed requirement redefinition before later mutations when direct user requirements change. */
  requirementDefinitionPolicy?: 1;
  /** Durable fail-closed marker paired with the exact rejected definition repair draft. */
  requirementDefinitionRepairPending?: 1;
  rejectedRequirementDefinitionDraft?: PersistedRejectedRequirementDefinitionDraft;
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
    /** Stable hash of task-owned workspace state and metadata-only external receipts. */
    effectStateHash?: string;
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
  testOutcome?: "passed" | "unconfirmed";
  verificationFailureKind?: "missing_test_script";
  proofWitnesses?: TaskVerificationProofWitness[];
  isError: boolean;
  nativeIsError?: boolean;
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

export type RequirementAuditInput = Static<typeof RequirementAuditInputSchema>;

export interface VerificationResult {
  status: "updated" | "needs_action";
  message: string;
  state: TaskVerificationState;
  contextExtract?: { summary: string; relevantLines: string[] };
  requirementDefinitionDiagnosticCount?: number;
}
