import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseBenchmarkCandidateVersion } from "../harness/candidate-version.ts";
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
    createPairedSummary(document.samples, document.gate.passed && document.completed, document.tasks, document.runs) ??
    null;
  writeFileSync(join(output, "results.json"), `${JSON.stringify(document, null, 2)}\n`, "utf8");
  writeFileSync(join(output, "report.md"), renderPairedReport(document), "utf8");
}
