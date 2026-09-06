import { createExactFinalByteObligation } from "./evidence-critical-proof.ts";
import { exactFinalByteProofDomains } from "./evidence-critical-proof-source.ts";
import { MAX_REQUIREMENT_SOURCE_BYTES } from "./referenced-requirement-sources.ts";
import { inspectRequirementSourceFile } from "./requirement-source-file.ts";
import type {
  TaskVerificationCriticalProofDiscoveryFailure,
  TaskVerificationCriticalProofObligation,
  TaskVerificationCriticalProofSourceOutput,
  TaskVerificationCriticalProofSourceSelection,
} from "./types.ts";

export interface RecomputedCriticalProofSelections {
  obligations: TaskVerificationCriticalProofObligation[];
  failures: TaskVerificationCriticalProofDiscoveryFailure[];
  selections: TaskVerificationCriticalProofSourceSelection[];
}

export type CriticalProofSourceSelectionCandidate = Omit<
  TaskVerificationCriticalProofSourceSelection,
  "sourceSha256"
> & { sourceSha256?: string };

export function recomputeCriticalProofSelections(
  cwd: string,
  selections: readonly CriticalProofSourceSelectionCandidate[],
  sourceOutputs: readonly TaskVerificationCriticalProofSourceOutput[] = [],
): RecomputedCriticalProofSelections {
  const obligations: TaskVerificationCriticalProofObligation[] = [];
  const failures: TaskVerificationCriticalProofDiscoveryFailure[] = [];
  const inspectedSelections: TaskVerificationCriticalProofSourceSelection[] = [];
  for (const selection of selections) {
    const sourceOutput = sourceOutputs.find((output) => output.sourcePath === selection.sourcePath);
    if (sourceOutput) {
      const sourceSha256 = sourceOutput.baselineState.slice(sourceOutput.baselineState.lastIndexOf(":") + 1);
      inspectedSelections.push({ ...selection, sourceSha256 });
      for (const domain of sourceOutput.criticalDomains) {
        obligations.push(createExactFinalByteObligation(selection.sourcePath, sourceSha256, domain));
      }
      continue;
    }
    const inspected = inspectRequirementSourceFile(cwd, selection.sourcePath, MAX_REQUIREMENT_SOURCE_BYTES);
    if (typeof inspected === "string") {
      failures.push({ sourcePath: selection.sourcePath, reason: inspected.slice(0, 500) });
      if (selection.sourceSha256) {
        inspectedSelections.push({ ...selection, sourceSha256: selection.sourceSha256 });
      }
      continue;
    }
    if (selection.sourceSha256 && selection.sourceSha256 !== inspected.sha256) {
      failures.push({
        sourcePath: selection.sourcePath,
        reason: `${selection.sourcePath} changed after it was selected. Re-read the full source before refreshing the completion checklist.`,
      });
      inspectedSelections.push({ ...selection, sourceSha256: selection.sourceSha256 });
      continue;
    }
    inspectedSelections.push({ ...selection, sourceSha256: inspected.sha256 });
    for (const domain of exactFinalByteProofDomains(inspected.text)) {
      obligations.push(createExactFinalByteObligation(selection.sourcePath, inspected.sha256, domain));
    }
  }
  return {
    obligations: [...new Map(obligations.map((obligation) => [obligation.id, obligation])).values()].sort(
      (left, right) => left.id.localeCompare(right.id),
    ),
    failures,
    selections: inspectedSelections,
  };
}
