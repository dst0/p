import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import type { TaskVerificationEvidence } from "../types.ts";
import { formatCompletionChecklist } from "./completion-checklist.ts";
import { evidenceHasRecordedExternalEffect } from "./external-effect-receipt.ts";
import {
  evidenceIsConfirmedExternalReadback,
  evidenceIsCurrentDeclaredExternalReadback,
  evidenceIsDeclaredExternalReadback,
} from "./external-readback-evidence.ts";

export function formatEvidenceStatus(self: TaskVerificationController): string {
  const external = [...self.evidence.values()].filter(
    (item) => !item.isError && evidenceHasRecordedExternalEffect(self, item),
  );
  const externalRefs = new Set(external.map((item) => item.ref));
  const readbacks = [...self.evidence.values()].filter(
    (item) =>
      !item.isError &&
      item.mutationRevision === self.state.mutationRevision &&
      evidenceIsConfirmedExternalReadback(item) &&
      evidenceIsCurrentDeclaredExternalReadback(self, item),
  );
  const reservedRefs = new Set([...externalRefs, ...readbacks.map((item) => item.ref)]);
  const current = [...self.evidence.values()]
    .filter(
      (item) =>
        !item.isError &&
        item.mutationRevision === self.state.mutationRevision &&
        !reservedRefs.has(item.ref) &&
        !evidenceIsDeclaredExternalReadback(item),
    )
    .slice(-12);
  const eligibleEvidence = [...external, ...readbacks, ...current];
  return [
    self.formatNextRequirement(),
    "Verification mode: evidence",
    `Mutation revision: ${self.state.mutationRevision}`,
    `Readiness: ${self.state.readiness?.status ?? "pending"}`,
    ...formatCompletionChecklist(self),
    `Unverified test paths: ${(self.state.unverifiedTestPaths ?? []).join(", ") || "none"}`,
    `Recent failed verification commands: ${self.latestFailedVerificationEvidence().length}`,
    "Eligible current-revision or recorded external-effect evidence:",
    ...(eligibleEvidence.length > 0 ? eligibleEvidence.map(formatEvidence) : ["- none"]),
  ].join("\n");
}

function formatEvidence(item: TaskVerificationEvidence): string {
  const receipt = item.externalEffectReceiptId ? ` [${item.externalEffectReceiptId} via ${item.toolName}]` : "";
  const readback = evidenceIsDeclaredExternalReadback(item) ? ` [readback via ${item.toolName}]` : "";
  return `- ${item.ref}${receipt}${readback}: ${item.descriptor} (${item.outputSummary || "no summary"})`;
}
