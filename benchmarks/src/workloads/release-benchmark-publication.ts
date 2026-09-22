import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { persistBenchmarkCertification } from "../../../scripts/release-benchmark-certification.js";
import { type BenchmarkRowLike, type CertificationOutcome, evaluateCertification } from "./certification.ts";
import type { RunnerOptions } from "./runner-options.ts";
import { benchmarkTasks } from "./task-registry.ts";

export interface ReleaseBenchmarkBindingHashes extends Record<string, string> {
  candidateRuntimeSha256: string;
  evaluatorSha256: string;
  holdoutSha256: string;
  kiloExecutableSha256: string;
  modelConfigurationSha256: string;
  nodeExecutableSha256: string;
  piExecutableSha256: string;
  projectInstructionsSha256: string;
}

interface ReleaseBenchmarkPublicationInput {
  repoRoot: string;
  resultPath: string;
  reportPath: string;
  options: RunnerOptions;
  certification: CertificationOutcome;
  now?: () => Date;
  persist?: typeof persistBenchmarkCertification;
}

const canonicalAgents = ["p", "pi", "kilo"];
const canonicalTasks = benchmarkTasks.map(({ id }) => id);
const hashPattern = /^[a-f0-9]{64}$/u;

export function publishReleaseBenchmarkCertification(input: ReleaseBenchmarkPublicationInput): unknown {
  const targetVersion = input.options.releaseTarget;
  if (!targetVersion) return undefined;
  if (!input.options.certified || input.options.runs !== 3) {
    throw new Error("Release benchmark publication requires certified mode with exactly 3 runs");
  }
  if (!input.certification.passed || input.certification.failures.length > 0) {
    throw new Error("Release benchmark certification did not pass");
  }
  if (!input.certification.binding || !input.certification.thresholds) {
    throw new Error("Release benchmark certification is missing bound runtime evidence");
  }
  const harness = requireFinalHarnessBinding(input.certification.binding);
  const binding = deriveReleaseBenchmarkBinding(harness);
  validateBinding(binding, harness);

  const resultContents = readFileSync(input.resultPath);
  const reportContents = readFileSync(input.reportPath);
  const document = parseResultDocument(resultContents);
  validateStoredResult(document, input);
  const report = reportContents.toString("utf8");
  if (!report.includes("## Certification Results") || !report.includes("**Result: PASSED**")) {
    throw new Error("Release benchmark report does not contain a passing certification result");
  }

  const resultSha256 = hash(resultContents);
  const reportSha256 = hash(reportContents);
  const evidence = {
    targetVersion,
    resultSha256,
    reportSha256,
    matrix: {
      agents: [...canonicalAgents],
      tasks: [...canonicalTasks],
      runs: 3,
      cellCount: 36,
      expectedResolvedModel: input.options.expectedResolvedModel!,
    },
    binding,
    thresholds: {
      maxDurationRatio: input.certification.thresholds.maxDurationRatio,
      maxTokenRatio: input.certification.thresholds.maxTokenRatio,
      maxCostRatio: input.certification.thresholds.maxCostRatio ?? null,
    },
    createdAt: (input.now ?? (() => new Date()))().toISOString(),
  };
  if (hash(readFileSync(input.resultPath)) !== resultSha256 || hash(readFileSync(input.reportPath)) !== reportSha256) {
    throw new Error("Release benchmark artifacts changed during publication");
  }
  return (input.persist ?? persistBenchmarkCertification)(input.repoRoot, evidence, {
    resultPath: input.resultPath,
    reportPath: input.reportPath,
  });
}

function validateStoredResult(document: Record<string, unknown>, input: ReleaseBenchmarkPublicationInput): void {
  if (!sameArray(document.agents, canonicalAgents) || document.runs !== 3) {
    throw new Error("Stored release benchmark does not contain the canonical agent matrix");
  }
  const tasks = Array.isArray(document.tasks)
    ? document.tasks.map((task) => (isRecord(task) ? task.id : undefined))
    : undefined;
  if (!sameArray(tasks, canonicalTasks)) {
    throw new Error("Stored release benchmark does not contain the canonical task matrix");
  }
  const storedCertification = isRecord(document.certification) ? document.certification : undefined;
  if (
    storedCertification?.passed !== true ||
    !Array.isArray(storedCertification.failures) ||
    storedCertification.failures.length !== 0
  ) {
    throw new Error("Stored release benchmark certification is not passing");
  }
  if (!Array.isArray(document.results) || document.results.length !== 36) {
    throw new Error("Stored benchmark matrix did not pass certification: expected exactly 36 cells");
  }
  const outcome = evaluateCertification(
    document.results as BenchmarkRowLike[],
    input.options,
    input.certification.binding,
  );
  if (!outcome.passed) {
    throw new Error(`Stored benchmark matrix did not pass certification: ${outcome.failures.join("; ")}`);
  }
}

function validateBinding(
  binding: ReleaseBenchmarkBindingHashes,
  harness: NonNullable<CertificationOutcome["binding"]> & {
    evaluator: { path: string; sha256: string };
    holdoutSha256: string;
  },
): void {
  const keys = Object.keys(binding).sort();
  const expected = [
    "candidateRuntimeSha256",
    "evaluatorSha256",
    "holdoutSha256",
    "kiloExecutableSha256",
    "modelConfigurationSha256",
    "nodeExecutableSha256",
    "piExecutableSha256",
    "projectInstructionsSha256",
  ].sort();
  if (!sameArray(keys, expected)) throw new Error("Release benchmark binding has an unexpected field set");
  for (const [name, value] of Object.entries(binding)) {
    if (!hashPattern.test(value) || /^0+$/u.test(value))
      throw new Error(`Release benchmark has invalid binding ${name}`);
  }
  const expectedHarnessHashes = {
    candidateRuntimeSha256: harness.pSnapshot.sha256,
    evaluatorSha256: harness.evaluator?.sha256,
    holdoutSha256: harness.holdoutSha256,
    modelConfigurationSha256: harness.modelConfiguration.sha256,
    kiloExecutableSha256: harness.kilo.sha256,
    nodeExecutableSha256: harness.node.sha256,
    piExecutableSha256: harness.pi.sha256,
    projectInstructionsSha256: harness.projectInstructions.sha256,
  };
  for (const [name, value] of Object.entries(expectedHarnessHashes)) {
    if (binding[name as keyof ReleaseBenchmarkBindingHashes] !== value) {
      throw new Error(`Release benchmark binding ${name} does not match the certified runtime`);
    }
  }
}

export function deriveReleaseBenchmarkBinding(
  harness: NonNullable<CertificationOutcome["binding"]> & {
    evaluator: { path: string; sha256: string };
    holdoutSha256: string;
  },
): ReleaseBenchmarkBindingHashes {
  return {
    candidateRuntimeSha256: harness.pSnapshot.sha256,
    evaluatorSha256: harness.evaluator.sha256,
    holdoutSha256: harness.holdoutSha256,
    kiloExecutableSha256: harness.kilo.sha256,
    modelConfigurationSha256: harness.modelConfiguration.sha256,
    nodeExecutableSha256: harness.node.sha256,
    piExecutableSha256: harness.pi.sha256,
    projectInstructionsSha256: harness.projectInstructions.sha256,
  };
}

function requireFinalHarnessBinding(harness: NonNullable<CertificationOutcome["binding"]>): NonNullable<
  CertificationOutcome["binding"]
> & {
  evaluator: { path: string; sha256: string };
  holdoutSha256: string;
} {
  if (!hasFinalHarnessBinding(harness)) {
    throw new Error("Release benchmark certification is missing final sealed harness evidence");
  }
  return harness;
}

function hasFinalHarnessBinding(harness: NonNullable<CertificationOutcome["binding"]>): harness is NonNullable<
  CertificationOutcome["binding"]
> & {
  evaluator: { path: string; sha256: string };
  holdoutSha256: string;
} {
  if (!("evaluator" in harness) || !("holdoutSha256" in harness)) return false;
  const evaluator = harness.evaluator;
  const evaluatorRecord =
    typeof evaluator === "object" && evaluator !== null ? (evaluator as Record<string, unknown>) : undefined;
  return (
    typeof harness.holdoutSha256 === "string" &&
    typeof evaluatorRecord?.path === "string" &&
    typeof evaluatorRecord.sha256 === "string"
  );
}

function parseResultDocument(contents: Buffer): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(contents.toString("utf8"));
    if (!isRecord(value)) throw new Error("not an object");
    return value;
  } catch (error) {
    throw new Error("Release benchmark results are not valid JSON evidence", { cause: error });
  }
}

function sameArray(value: unknown, expected: readonly unknown[]): boolean {
  return Array.isArray(value) && JSON.stringify(value) === JSON.stringify(expected);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hash(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
