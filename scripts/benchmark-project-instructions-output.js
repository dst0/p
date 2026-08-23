import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseBenchmarkCandidateVersion } from "./benchmark-candidate-version.js";
import { createPairedSummary, renderPairedReport } from "./benchmark-project-instructions-core.js";

export function writePairedBenchmarkEvidence(output, document) {
  document.candidateVersion = parseBenchmarkCandidateVersion(document.candidateVersion);
  document.summary = createPairedSummary(document.samples, document.gate.passed && document.completed);
  writeFileSync(join(output, "results.json"), `${JSON.stringify(document, null, 2)}\n`, "utf8");
  writeFileSync(join(output, "report.md"), renderPairedReport(document), "utf8");
}
