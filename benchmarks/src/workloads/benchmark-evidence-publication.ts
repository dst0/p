import { homedir } from "node:os";
import { join } from "node:path";
import type { BenchmarkEvaluationFreeze } from "../harness/evaluation-freeze.ts";
import { benchmarkModels } from "../harness/model-attribution.ts";
import { type BenchmarkResult, createBenchmarkReport } from "../harness/report.ts";
import { sanitizeBenchmarkEvidence } from "../harness/result-sanitization.ts";
import type { ProjectInstructionAuthority } from "../project-instructions/outer-authority.ts";
import { nudgePenaltyPerNudge } from "./agent-turn-runner.ts";
import {
  type CertificationOutcome,
  type CertifiedHarnessBinding,
  finalizeCertifiedReport,
  recheckCertifiedHarness,
} from "./certification.ts";
import { publishReleaseBenchmarkCertification } from "./release-benchmark-publication.ts";
import { publishBenchmarkResults } from "./result-publication.ts";
import type { RunnerOptions } from "./runner-options.ts";
import type { AgyStartupEvidence, KiloStartupEvidence } from "./startup-probes.ts";
import type { BenchmarkTask } from "./task-definition.ts";

type BenchmarkResultRow = BenchmarkResult & Record<string, unknown>;

interface BenchmarkEvidencePublicationInput {
  options: RunnerOptions;
  versions: Readonly<Record<string, string>>;
  results: readonly BenchmarkResultRow[];
  output: string;
  repoRoot: string;
  tasks: readonly BenchmarkTask[];
  startupProbes: { kilo?: KiloStartupEvidence; agy?: AgyStartupEvidence };
  evaluationFreeze?: BenchmarkEvaluationFreeze;
  harnessBinding?: CertifiedHarnessBinding;
}

export interface BenchmarkEvidencePublication {
  certification?: CertificationOutcome;
  projectInstructionOuterAuthority?: ProjectInstructionAuthority;
  reportPath: string;
  resultPath: string;
  shouldFail: boolean;
  validateReleaseEvidence?: () => void;
  publishReleaseEvidence?: () => void;
}

export function publishBenchmarkEvidence(input: BenchmarkEvidencePublicationInput): BenchmarkEvidencePublication {
  const reportStartupProbes = Object.fromEntries(
    Object.entries(input.startupProbes)
      .filter(([_, probe]) => probe?.resolvedModel)
      .map(([key, probe]) => [key, { status: probe!.status, resolvedModel: probe!.resolvedModel! }]),
  );
  const summaries = createBenchmarkReport(
    input.options,
    input.versions,
    input.results,
    input.output,
    input.tasks,
    reportStartupProbes,
    nudgePenaltyPerNudge,
  );
  const certification = finalizeCertifiedReport(
    input.options,
    input.results,
    input.output,
    input.evaluationFreeze,
    input.harnessBinding,
  );
  const document = {
    generatedAt: new Date().toISOString(),
    agents: input.options.agents,
    models: benchmarkModels(input.options),
    versions: input.versions,
    startupProbes: input.startupProbes,
    runs: input.options.runs,
    timeoutSeconds: input.options.timeoutSeconds,
    maxRuntimeSeconds: input.options.maxRuntimeSeconds,
    projectInstructions: input.options.projectInstructions,
    taskVerificationMode: input.options.taskVerificationMode,
    tasks: input.tasks.map(({ id, description, timeoutSeconds }) => ({ id, description, timeoutSeconds })),
    summaries,
    ...(certification ? { certification: createPublicCertificationEvidence(certification) } : {}),
    results: input.results,
  };
  const sanitized = sanitizeBenchmarkEvidence(document, {
    output: input.output,
    repoRoot: input.repoRoot,
    home: homedir(),
  });
  const resultPath = join(input.output, "results.json");
  const projectInstructionOuterAuthority = publishBenchmarkResults(
    resultPath,
    sanitized,
    input.options.certified,
    input.options.projectInstructions,
  );
  const releaseHooks = createReleaseHooks(input, certification, resultPath, join(input.output, "report.md"));
  return {
    certification,
    projectInstructionOuterAuthority,
    reportPath: join(input.output, "report.md"),
    resultPath,
    shouldFail:
      !input.results.some((result) => result.status !== "skipped") ||
      (certification !== undefined && !certification.passed),
    ...releaseHooks,
  };
}

export function createPublicCertificationEvidence(certification: CertificationOutcome): Record<string, unknown> {
  const binding = certification.binding;
  if (!binding) return { ...certification };
  const finalBinding = isFinalHarnessBinding(binding)
    ? {
        evaluator: { sha256: binding.evaluator.sha256 },
        holdoutSha256: binding.holdoutSha256,
      }
    : {};
  return {
    passed: certification.passed,
    failures: certification.failures,
    ...(certification.thresholds ? { thresholds: certification.thresholds } : {}),
    binding: {
      node: { version: binding.node.version, sha256: binding.node.sha256 },
      pSnapshot: { version: binding.pSnapshot.version, sha256: binding.pSnapshot.sha256 },
      pi: { version: binding.pi.version, sha256: binding.pi.sha256 },
      kilo: { version: binding.kilo.version, sha256: binding.kilo.sha256 },
      modelConfiguration: { sha256: binding.modelConfiguration.sha256 },
      projectInstructions: {
        sha256: binding.projectInstructions.sha256,
        ...(binding.projectInstructions.receiptSha256
          ? { receiptSha256: binding.projectInstructions.receiptSha256 }
          : {}),
      },
      ...(binding.receipts ? { receipts: binding.receipts } : {}),
      ...finalBinding,
    },
  };
}

function isFinalHarnessBinding(
  binding: NonNullable<CertificationOutcome["binding"]>,
): binding is CertifiedHarnessBinding {
  const candidate = binding as Partial<CertifiedHarnessBinding>;
  return candidate.evaluator !== undefined && typeof candidate.holdoutSha256 === "string";
}

function createReleaseHooks(
  input: BenchmarkEvidencePublicationInput,
  certification: CertificationOutcome | undefined,
  resultPath: string,
  reportPath: string,
): Pick<BenchmarkEvidencePublication, "publishReleaseEvidence" | "validateReleaseEvidence"> {
  if (!input.options.releaseTarget || !certification?.passed) return {};
  if (!input.evaluationFreeze || !input.harnessBinding) {
    throw new Error("Passing release benchmark evidence is missing the frozen certified harness");
  }
  return {
    validateReleaseEvidence: () =>
      recheckCertifiedHarness(
        input.harnessBinding!,
        input.evaluationFreeze!.candidateRuntimePath,
        input.evaluationFreeze!.candidateRuntimeSha256,
      ),
    publishReleaseEvidence: () => {
      publishReleaseBenchmarkCertification({
        repoRoot: input.repoRoot,
        resultPath,
        reportPath,
        options: input.options,
        certification,
      });
    },
  };
}
