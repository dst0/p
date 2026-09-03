import { REQUIREMENT_AUDIT_TOOL_NAME } from "../constants.ts";
import { selectorsMatchProofPolicies } from "../requirement-proof-evidence.ts";
import { isProductInvariantRequirementType } from "../requirement-risk.ts";
import type { TaskRequirement } from "../types.ts";
import { evidenceMatchesRequirement } from "./focused-evidence-relevance.ts";

export function formatRequirementBatchPrompt(requirements: readonly TaskRequirement[]): string {
  return [
    `Verify all ${requirements.length} requirements, then submit one atomic verdict batch:`,
    ...requirements.flatMap((requirement) => [
      `${requirement.id}: ${requirement.text}`,
      `Acceptance criterion: ${requirement.acceptanceCriterion}`,
      ...(activeProofPolicies(requirement).length
        ? [
            `Controller proof obligations: ${activeProofPolicies(requirement).map(formatProofPolicy).join("; ")}`,
            `Required focused selector contract: ${formatFocusedSelectorContract(requirement)}`,
            `Required same-run witness lines:\n${formatRequirementProofWitnessTemplates(requirement)}`,
          ]
        : []),
    ]),
    `Call ${REQUIREMENT_AUDIT_TOOL_NAME} once with action "verdict" and exactly one verdicts item for every listed ID.`,
    "Every item needs passed and a concrete reason. Every passed item needs current evidence_refs.",
    "High-risk product/runtime or artifact invariants involving integrity, security, durability, transactions, or concurrency require a relevant focused test with a positive passing result; generic suites and manual reproductions are insufficient.",
    "Each controller proof obligation additionally requires a valid one-line P_PROOF_V1 witness emitted inside that exact focused test during the same selected run; selector wording, standalone proof scripts, and separate commands are not proof.",
  ].join("\n");
}

export function formatRequirementProofPlan(requirements: readonly TaskRequirement[]): string | undefined {
  const obligations = requirements.flatMap((requirement) => {
    const policies = activeProofPolicies(requirement);
    if (policies.length === 0) return [];
    return [
      `${requirement.id}: ${policies.map(formatProofPolicy).join("; ")}. ${formatFocusedSelectorContract(requirement)} Run only that full case name with the test runner's case selector (for example, --test-name-pattern="..." or -t "...").`,
      `Add every following one-line witness inside that exact named test case before the first focused run, emitting them only after the assertions pass. A standalone proof script or separate command is invalid:\n${formatRequirementProofWitnessTemplates(requirement)}`,
    ];
  });
  return obligations.length > 0
    ? ["Controller-derived proof obligations to implement before verification:", ...obligations].join("\n")
    : undefined;
}

export function formatFocusedSelectorContract(requirement: TaskRequirement): string {
  const proofConcepts = activeProofPolicies(requirement).map(formatProofPolicy);
  const exactSelector = formatFocusedSelectorExample(requirement);
  return [
    `The selector itself must name the observable outcome ${JSON.stringify(requirement.acceptanceCriterion)}`,
    ...(proofConcepts.length > 0 ? [` and the proof concepts ${JSON.stringify(proofConcepts.join("; "))}`] : []),
    ". A shorter prefix is insufficient even when it matches a longer test name. ",
    `Use this exact safe case name and selector for the next test command: ${JSON.stringify(exactSelector)}. `,
    "Do not run the whole test file or suite first.",
  ].join("");
}

export function formatFocusedSelectorExample(requirement: TaskRequirement): string {
  const proofConcepts = activeProofPolicies(requirement).map(formatProofPolicy);
  const candidates = [
    requirement.text,
    requirement.acceptanceCriterion,
    [requirement.text, ...proofConcepts].join(" "),
    [requirement.acceptanceCriterion, ...proofConcepts].join(" "),
    [requirement.text, requirement.acceptanceCriterion].join(" "),
    [requirement.text, requirement.acceptanceCriterion, ...proofConcepts].join(" "),
  ].map(normalizedSelector);
  const matching = [...new Set(candidates)].filter(
    (candidate) =>
      evidenceMatchesRequirement(requirement, [candidate]) && selectorsMatchProofPolicies(requirement, [candidate]),
  );
  return matching.length > 0
    ? matching.sort((left, right) => left.length - right.length || left.localeCompare(right))[0]!
    : candidates.at(-1)!;
}

function normalizedSelector(value: string): string {
  return (
    value
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .match(/[\p{L}\p{N}]+/gu)
      ?.join(" ") ?? ""
  );
}

export function formatRequirementProofWitnessTemplates(requirement: TaskRequirement): string {
  return activeProofPolicies(requirement)
    .map((policy) => formatProofWitnessTemplate(requirement.id, policy))
    .join("\n");
}

function activeProofPolicies(requirement: TaskRequirement): NonNullable<TaskRequirement["proofPolicies"]> {
  return isProductInvariantRequirementType(requirement.type) ? (requirement.proofPolicies ?? []) : [];
}

function formatProofWitnessTemplate(
  requirementId: string,
  policy: NonNullable<TaskRequirement["proofPolicies"]>[number],
): string {
  return `P_PROOF_V1 ${JSON.stringify(proofFrameTemplate(requirementId, policy))}`;
}

function proofFrameTemplate(
  requirementId: string,
  policy: NonNullable<TaskRequirement["proofPolicies"]>[number],
): Record<string, unknown> {
  const common = { requirementId, policy };
  if (policy === "remove_exact_final_byte") {
    return {
      ...common,
      facts: { originalBase64: "<base64>", candidateBase64: "<base64>", outcome: "threw" },
    };
  }
  if (policy === "change_artifact_bytes") {
    return {
      ...common,
      facts: { originalBase64: "<base64>", candidateBase64: "<base64>" },
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
  if (policy === "change_artifact_bytes") return "prove the changed candidate differs from the original";
  if (policy === "preserve_state_on_failure") return "compare state before and after the failed operation";
  if (policy === "preserve_log_on_failure") return "compare the event log before and after the failed operation";
  if (policy === "preserve_version_on_failure") return "prove version does not advance on failure";
  if (policy === "preserve_position_on_failure") return "prove position does not advance on failure";
  return "prove a failed operation does not consume the same command identity used by a successful retry";
}
