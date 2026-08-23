import { existsSync } from "node:fs";
import { join } from "node:path";
import { hashFile, validateProjectInstructionEvidence } from "./benchmark-project-instruction-evidence.js";
import { projectProjectInstructionEvidence } from "./benchmark-project-instruction-evidence-projection.js";
import {
  assertChildSampleMetrics,
  assertNoStartupProbeCaptureOverflow,
  verifyResolvedPModel,
} from "./benchmark-project-instructions-core.js";
import { BenchmarkChildResultError } from "./benchmark-project-instructions-child-result.js";
import { projectPairedChildSample } from "./benchmark-project-instructions-sample-projection.js";

function invalid(code, message) {
  throw new BenchmarkChildResultError(code, message);
}

export function createValidatedPairedSample(parsed, context) {
  const { document, result } = parsed;
  try {
    assertNoStartupProbeCaptureOverflow(document.startupProbes);
  } catch {
    invalid("invalid_startup_probe", "child benchmark startup-probe evidence is invalid");
  }
  if (document.projectInstructions !== context.mode) {
    invalid("invalid_mode", "child benchmark project-instruction mode is invalid");
  }
  if (document.runs !== 1 || document.agents?.length !== 1 || document.agents[0] !== "p") {
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
  const projectInstructionEvidence = projectProjectInstructionEvidence(result.projectInstructionEvidence);
  const instructionAssessment = validateProjectInstructionEvidence(
    projectInstructionEvidence,
    context.mode,
    context.options.sourceSha256,
    context.mode === "compiled"
      ? { receipt: context.seedMaterialization.receipt, certificate: context.options.seed.certificate }
      : undefined,
  );
  if (!instructionAssessment.passed) {
    invalid("invalid_instruction_evidence", "child benchmark project-instruction evidence is invalid");
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
    mode: context.mode,
    runtimeSha256: context.runtimeSha256,
    resolvedModel,
    tokenAccounting: { session: publicResult.metrics.usage },
    seedEvidence:
      context.mode === "compiled"
        ? {
            certificationHash: context.options.seed.certificate.compilerPreparation.certificationHash,
            cacheClosureSha256: context.seedMaterialization.receipt.cacheClosureSha256,
          }
        : undefined,
    evidence: join("cells", `run-${context.pair.run}`, context.pair.task, context.mode),
  };
}
