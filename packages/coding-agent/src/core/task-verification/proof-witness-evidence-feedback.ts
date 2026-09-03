import type { ProofWitnessAnalysis } from "./requirement-proof-witnesses.ts";
import type { TaskRequirement } from "./types.ts";

const MAX_ACCEPTED_DETAILS = 4;

export function formatProofWitnessEvidenceFeedback(
  analysis: ProofWitnessAnalysis,
  requirements: readonly TaskRequirement[],
): string | undefined {
  if (analysis.frameCount === 0) return undefined;
  const acceptedCount = analysis.witnesses?.length ?? 0;
  const lines = [summary(analysis.frameCount, acceptedCount, analysis.rejectedFrameCount)];
  for (const witness of analysis.witnesses?.slice(0, MAX_ACCEPTED_DETAILS) ?? []) {
    lines.push(
      `Accepted requirementId ${JSON.stringify(witness.requirementId)} with policy ${JSON.stringify(witness.policy)}.`,
    );
  }
  if (acceptedCount > MAX_ACCEPTED_DETAILS) {
    lines.push(`${acceptedCount - MAX_ACCEPTED_DETAILS} additional accepted frames omitted from this bounded summary.`);
  }
  const acceptedRequirementIds = [...new Set(analysis.witnesses?.map((witness) => witness.requirementId) ?? [])];
  for (const requirementId of acceptedRequirementIds.slice(0, MAX_ACCEPTED_DETAILS)) {
    const requirement = requirements.find((candidate) => candidate.id === requirementId);
    const complete = requirement?.proofPolicies?.every((policy) =>
      analysis.witnesses?.some((witness) => witness.requirementId === requirementId && witness.policy === policy),
    );
    lines.push(
      complete
        ? `Complete proof for requirementId ${JSON.stringify(requirementId)} is stored on this evidence handle; do not regenerate it.`
        : `Proof for requirementId ${JSON.stringify(requirementId)} is incomplete on this evidence handle. Rerun the same focused test with every controller-required frame together, preserving accepted assertions and correcting missing or rejected frames.`,
    );
  }
  if (acceptedRequirementIds.length > MAX_ACCEPTED_DETAILS) {
    lines.push(
      `${acceptedRequirementIds.length - MAX_ACCEPTED_DETAILS} additional accepted requirement guidance entries omitted from this bounded summary.`,
    );
  }
  lines.push(...analysis.rejectionDetails);
  const omittedRejections = analysis.rejectedFrameCount - analysis.rejectionDetails.length;
  if (omittedRejections > 0) {
    lines.push(`${omittedRejections} additional rejection reasons omitted from this bounded summary.`);
  }
  if (analysis.rejectedFrameCount > 0) {
    lines.push("Use the exact controller proof template. Do not recompute requirement IDs or policies.");
  }
  return lines.join("\n");
}

function summary(frameCount: number, acceptedCount: number, rejectedCount: number): string {
  if (acceptedCount === 0) return `Rejected ${rejectedCount} of ${frameCount} P_PROOF_V1 frames.`;
  if (rejectedCount === 0) return `Accepted ${acceptedCount} of ${frameCount} P_PROOF_V1 frames.`;
  return `Accepted ${acceptedCount} of ${frameCount} P_PROOF_V1 frames; rejected ${rejectedCount}.`;
}
