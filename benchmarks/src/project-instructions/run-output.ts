import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseBenchmarkCandidateVersion } from "../harness/candidate-version.ts";
import { assertCertifiedOutputWritePath } from "../harness/certified-output-integrity.ts";
import { createPairedSummary, renderPairedReport } from "./run-report.ts";

type PairedBenchmarkDocument = Parameters<typeof renderPairedReport>[0] & {
  candidateVersion: string;
  completed: boolean;
  gate: { passed: boolean };
  samples: Parameters<typeof createPairedSummary>[0];
  summary?: ReturnType<typeof createPairedSummary> | null;
};

export function writePairedBenchmarkEvidence(output: string, document: PairedBenchmarkDocument): void {
  document.candidateVersion = parseBenchmarkCandidateVersion(document.candidateVersion);
  document.summary =
    createPairedSummary(
      document.samples,
      document.gate.passed && document.completed,
      document.tasks,
      document.runs,
      document.conditions,
    ) ?? null;
  const resultsPath = join(output, "results.json");
  const reportPath = join(output, "report.md");
  assertCertifiedOutputWritePath(resultsPath);
  writeFileSync(resultsPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  assertCertifiedOutputWritePath(reportPath);
  writeFileSync(reportPath, renderPairedReport(document), "utf8");
}
