import { existsSync } from "node:fs";
import { join } from "node:path";
import { hashFile, validateProjectInstructionEvidence } from "./evidence.ts";
import { projectProjectInstructionEvidence } from "./evidence-projection.ts";
import { applyProjectInstructionOuterAuthority } from "./outer-authority.ts";
import { BenchmarkChildResultError } from "./run-child-result.ts";
import type {
  PairedSample,
  ProjectInstructionCondition,
  ProjectInstructionMode,
  TaskVerificationMode,
} from "./run-core.ts";
import { assertChildSampleMetrics, assertNoStartupProbeCaptureOverflow, verifyResolvedPModel } from "./run-core.ts";
import { projectPairedChildSample } from "./run-sample-projection.ts";
import { projectRuntimeTaskVerificationProof } from "./verification-sample-proof.ts";

type ChildResult = Record<string, unknown> & {
  run: number;
  agent: string;
  task: string;
  status: string;
  elapsedMs: number;
  metrics: PairedSample["metrics"];
  quality: PairedSample["quality"];
  captureOverflow?: PairedSample["captureOverflow"];
  projectInstructionEvidence?: Record<string, unknown>;
};

type ChildDocument = Record<string, unknown> & {
  startupProbes?: unknown;
  projectInstructions?: unknown;
  taskVerificationMode?: unknown;
  runs?: unknown;
  agents?: unknown[];
  models?: { p?: unknown };
};

export type PairedSampleContext = {
  proofReceiptSha256: string;
  condition: ProjectInstructionCondition;
  mode: ProjectInstructionMode;
  taskVerificationMode: TaskVerificationMode;
  pair: { run: number; task: string };
  scratchOutput: string;
  runtimeSha256: string;
  projectInstructionAuthority: {
    expectedTurnCount: number;
    resultSha256: string;
    baseSystemModeProofs: unknown[];
    userTurns: unknown[];
  };
  seedMaterialization?: { receipt: { cacheClosureSha256: string } };
  options: {
    model: string;
    sourceSha256: string;
    seed: { certificate: { compilerPreparation: { certificationHash: string } } };
  };
};

function invalid(code: string, message: string): never {
  throw new BenchmarkChildResultError(code, message);
}

export function createValidatedPairedSample(
  parsed: { document: ChildDocument; result: ChildResult; resultSha256: string },
  context: PairedSampleContext,
): PairedSample {
  const { document, result } = parsed;
  if (!/^[a-f0-9]{64}$/u.test(context.proofReceiptSha256)) {
    invalid("invalid_proof_receipt", "parent benchmark startup-proof receipt is invalid");
  }
  try {
    assertNoStartupProbeCaptureOverflow(
      typeof document.startupProbes === "object" && document.startupProbes !== null
        ? (document.startupProbes as Parameters<typeof assertNoStartupProbeCaptureOverflow>[0])
        : undefined,
    );
  } catch {
    invalid("invalid_startup_probe", "child benchmark startup-probe evidence is invalid");
  }
  if (document.projectInstructions !== context.mode) {
    invalid("invalid_mode", "child benchmark project-instruction mode is invalid");
  }
  if (document.taskVerificationMode !== context.taskVerificationMode) {
    invalid("invalid_verification_mode", "child benchmark task-verification mode is invalid");
  }
  if (
    document.runs !== 1 ||
    !Array.isArray(document.agents) ||
    document.agents.length !== 1 ||
    document.agents[0] !== "p"
  ) {
    invalid("invalid_run_metadata", "child benchmark run metadata is invalid");
  }
  if (document.models?.p !== context.options.model) {
    invalid("invalid_model", "child benchmark model identity is invalid");
  }
  if (result.run !== 1 || result.agent !== "p" || result.task !== context.pair.task) {
    invalid("invalid_result_identity", "child benchmark result identity is invalid");
  }
  assertChildSampleMetrics(result);
  const workspaceAgents = join(context.scratchOutput, "workspaces", "p", "run-1", context.pair.task, "AGENTS.md");
  if (!existsSync(workspaceAgents) || hashFile(workspaceAgents) !== context.options.sourceSha256) {
    invalid("invalid_fixture", "child benchmark fixture identity is invalid");
  }
  try {
    if (!result.projectInstructionEvidence) throw new Error("child benchmark proof evidence is missing");
    applyProjectInstructionOuterAuthority(
      result.projectInstructionEvidence,
      context.projectInstructionAuthority,
      parsed.resultSha256,
    );
  } catch {
    invalid("invalid_outer_authority", "child benchmark proof evidence does not match outer authority");
  }
  const projectInstructionEvidence = projectProjectInstructionEvidence(result.projectInstructionEvidence);
  const instructionAssessment = validateProjectInstructionEvidence(
    projectInstructionEvidence as Parameters<typeof validateProjectInstructionEvidence>[0],
    context.mode,
    context.options.sourceSha256,
    context.mode === "compiled"
      ? {
          receipt: context.seedMaterialization?.receipt,
          certificate: context.options.seed.certificate,
        }
      : undefined,
    context.proofReceiptSha256,
    context.taskVerificationMode,
  );
  if (!instructionAssessment.passed) {
    invalid(
      "invalid_instruction_evidence",
      `child benchmark project-instruction evidence is invalid: ${instructionAssessment.reason ?? "unspecified validation failure"}`,
    );
  }
  const taskVerificationProof = projectRuntimeTaskVerificationProof(projectInstructionEvidence);
  if (!taskVerificationProof) {
    invalid("invalid_verification_proof", "child benchmark runtime task-verification proof is invalid");
  }
  const resolvedModel = verifyResolvedPModel(context.options.model, result.metrics, {
    requireResponseModel: result.status === "passed",
  });
  const publicResult = projectPairedChildSample(result, projectInstructionEvidence);
  if (!publicResult) invalid("invalid_public_sample", "child benchmark public sample fields are invalid");
  return {
    ...publicResult,
    run: context.pair.run,
    childRun: result.run,
    condition: context.condition,
    mode: context.mode,
    taskVerificationMode: context.taskVerificationMode,
    runtimeSha256: context.runtimeSha256,
    resolvedModel,
    tokenAccounting: { session: publicResult.metrics.usage },
    projectInstructionProofReceipt: {
      sha256: context.proofReceiptSha256,
      expectedTurnCount: context.projectInstructionAuthority.expectedTurnCount,
      resultSha256: context.projectInstructionAuthority.resultSha256,
    },
    taskVerificationProof,
    seedEvidence:
      context.mode === "compiled"
        ? {
            certificationHash: context.options.seed.certificate.compilerPreparation.certificationHash,
            cacheClosureSha256: context.seedMaterialization?.receipt.cacheClosureSha256,
          }
        : undefined,
    evidence: join("cells", `run-${context.pair.run}`, context.pair.task, context.condition),
  };
}
