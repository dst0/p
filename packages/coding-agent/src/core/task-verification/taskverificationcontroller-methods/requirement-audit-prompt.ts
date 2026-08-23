import { REQUIREMENT_AUDIT_TOOL_NAME } from "../constants.ts";
import type { TaskRequirement } from "../types.ts";

export function formatRequirementBatchPrompt(requirements: readonly TaskRequirement[]): string {
  return [
    `Verify all ${requirements.length} requirements, then submit one atomic verdict batch:`,
    ...requirements.flatMap((requirement) => [
      `${requirement.id}: ${requirement.text}`,
      `Acceptance criterion: ${requirement.acceptanceCriterion}`,
      ...(requirement.proofPolicies?.length
        ? [`Controller proof obligations: ${requirement.proofPolicies.map(formatProofPolicy).join("; ")}`]
        : []),
    ]),
    `Call ${REQUIREMENT_AUDIT_TOOL_NAME} once with action "verdict" and exactly one verdicts item for every listed ID.`,
    "Every item needs passed and a concrete reason. Every passed item needs current evidence_refs.",
    "High-risk integrity, security, durability, transaction, and concurrency invariants require a relevant focused test with a positive passing result; generic suites and manual reproductions are insufficient.",
    "Each controller proof obligation additionally requires a valid one-line P_PROOF_V1 witness emitted by that focused test; selector wording alone is not proof.",
  ].join("\n");
}

export function formatRequirementProofPlan(requirements: readonly TaskRequirement[]): string | undefined {
  const obligations = requirements.flatMap((requirement) =>
    (requirement.proofPolicies ?? []).flatMap((policy) => [
      `${requirement.id}: ${formatProofPolicy(policy)}. Name the focused test with these exact concepts.`,
      `Witness after the assertions pass: P_PROOF_V1 ${JSON.stringify(proofFrameTemplate(requirement.id, policy))}`,
    ]),
  );
  return obligations.length > 0
    ? ["Controller-derived proof obligations to implement before verification:", ...obligations].join("\n")
    : undefined;
}

function proofFrameTemplate(
  requirementId: string,
  policy: NonNullable<TaskRequirement["proofPolicies"]>[number],
): Record<string, unknown> {
  const common = { requirementId, policy };
  if (policy === "remove_exact_final_byte" || policy === "change_artifact_bytes") {
    return {
      ...common,
      facts: { originalBase64: "<base64>", candidateBase64: "<base64>", outcome: "threw" },
    };
  }
  if (policy === "preserve_state_on_failure" || policy === "preserve_log_on_failure") {
    return {
      ...common,
      facts: { beforeBase64: "<base64>", afterFailureBase64: "<base64>", failedOutcome: "threw" },
    };
  }
  if (policy === "preserve_version_on_failure" || policy === "preserve_position_on_failure") {
    return {
      ...common,
      facts: {
        before: 4,
        afterFailure: 4,
        afterSuccess: 5,
        failedOutcome: "threw",
        successOutcome: "succeeded",
      },
    };
  }
  return {
    ...common,
    facts: {
      failedIdentity: "same-command-id",
      retryIdentity: "same-command-id",
      failedOutcome: "threw",
      retryOutcome: "succeeded",
    },
  };
}

function formatProofPolicy(policy: NonNullable<TaskRequirement["proofPolicies"]>[number]): string {
  if (policy === "remove_exact_final_byte") return "remove exactly the final byte and prove rejection";
  if (policy === "change_artifact_bytes") return "prove the corrupted candidate differs from the original";
  if (policy === "preserve_state_on_failure") return "compare state before and after the failed operation";
  if (policy === "preserve_log_on_failure") return "compare the event log before and after the failed operation";
  if (policy === "preserve_version_on_failure") return "prove version does not advance on failure";
  if (policy === "preserve_position_on_failure") return "prove position does not advance on failure";
  return "prove a failed operation does not consume the same command identity used by a successful retry";
}
