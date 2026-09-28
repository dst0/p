import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { assertCertifiedOutputWritePath } from "../harness/certified-output-integrity.ts";
import type { BenchmarkEvaluationFreeze } from "../harness/evaluation-freeze.ts";
import { benchmarkModels } from "../harness/model-attribution.ts";
import { type BenchmarkResult, createBenchmarkReport } from "../harness/report.ts";
import { sanitizeBenchmarkEvidence } from "../harness/result-sanitization.ts";
import {
  type ProjectInstructionAuthority,
  writeProjectInstructionResultPublication,
} from "../project-instructions/outer-authority.ts";
import { nudgePenaltyPerNudge } from "./agent-turn-runner.ts";
import { type CertifiedHarnessBinding, finalizeCertifiedReport } from "./certification.ts";
import type { AgentVersions } from "./installed-agent-versions.ts";
import type { RunnerOptions } from "./runner-options.ts";
import type { BenchmarkTask } from "./task-definition.ts";

export interface BenchmarkPublicationInput {
  options: RunnerOptions;
  versions: AgentVersions;
  results: readonly (BenchmarkResult & Record<string, unknown>)[];
  output: string;
  repoRoot: string;
  tasks: readonly BenchmarkTask[];
  startupProbes: Readonly<Record<string, { status: string; resolvedModel?: string }>>;
  freeze?: BenchmarkEvaluationFreeze;
  binding?: CertifiedHarnessBinding;
}

export function completeBenchmarkReport(input: BenchmarkPublicationInput): {
  authority?: ProjectInstructionAuthority;
  certificationPassed: boolean;
} {
  const { options, versions, results, output, repoRoot, tasks, startupProbes, freeze, binding } = input;
  const reportProbes: Record<string, { status: string; resolvedModel: string }> = {};
  for (const [name, probe] of Object.entries(startupProbes)) {
    if (probe.resolvedModel) reportProbes[name] = { status: probe.status, resolvedModel: probe.resolvedModel };
  }
  const summaries = createBenchmarkReport(
    options,
    versions,
    results,
    output,
    tasks,
    reportProbes,
    nudgePenaltyPerNudge,
  );
  const certification = finalizeCertifiedReport(options, results, output, freeze, binding);
  const document = {
    generatedAt: new Date().toISOString(),
    agents: options.agents,
    models: benchmarkModels(options),
    versions,
    startupProbes,
    runs: options.runs,
    timeoutSeconds: options.timeoutSeconds,
    maxRuntimeSeconds: options.maxRuntimeSeconds,
    projectInstructions: options.projectInstructions,
    taskVerificationMode: options.taskVerificationMode,
    tasks: tasks.map(({ id, description, timeoutSeconds }) => ({ id, description, timeoutSeconds })),
    summaries,
    ...(certification ? { certification } : {}),
    results,
  };
  const sanitized = sanitizeBenchmarkEvidence(document, { output, repoRoot, home: homedir() });
  const authority = publishBenchmarkResults(
    join(output, "results.json"),
    sanitized,
    options.certified,
    options.projectInstructions,
  );
  console.log(`Report: ${join(output, "report.md")}`);
  return { authority, certificationPassed: certification?.passed ?? true };
}

export function publishBenchmarkResults(
  path: string,
  document: unknown,
  certified?: boolean,
  projectInstructions?: unknown,
): ProjectInstructionAuthority | undefined {
  if (certified) {
    assertCertifiedOutputWritePath(path, true);
    const contents = `${JSON.stringify(document, null, 2)}\n`;
    writeFileSync(path, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return undefined;
  }
  return writeProjectInstructionResultPublication(
    path,
    document as Parameters<typeof writeProjectInstructionResultPublication>[1],
    projectInstructions,
  );
}
